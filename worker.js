export default {
  async fetch(r, e) {
    // 1. Retry utility function with exponential backoff
    async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await fn();
        } catch (error) {
          const isLastAttempt = attempt === maxRetries - 1;
          if (isLastAttempt) throw error;

          const delay = baseDelay * Math.pow(2, attempt);
          console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // 2. Check method
    if (r.method !== "POST") {
      return new Response("Only POST", { status: 405, headers: { Allow: "POST" } });
    }

    // 3. Validate Configuration
    const discordUrl = e.DISCORD_WEBHOOK?.trim();
    if (!discordUrl) {
      return new Response("Error: Missing DISCORD_WEBHOOK_URL environment variable.", { status: 500 });
    }

    // 4. Validate AI Key
    const openrouterKey = e.OPENROUTER_API_KEY?.trim();
    if (!openrouterKey) {
      return new Response("Missing OPENROUTER_API_KEY env", { status: 500 });
    }

    // 5. Parse Body
    let payload;
    try {
      const contentType = r.headers.get("content-type") || "";
      payload = contentType.includes("json")
        ? JSON.stringify(await r.json(), null, 2) // Pretty print JSON for the LLM to read easier
        : await r.text();
    } catch {
      return new Response("Bad body", { status: 400 });
    }

    if (!payload) return new Response("No data", { status: 400 });

    // 5a. Smart payload trimming - Remove verbose technical details
    function trimVerboseContent(text) {
      try {
        // Patterns to remove (common verbose sections across different sources)
        const verbosePatterns = [
          // Email authentication headers
          /SPF Result:[\s\S]*?(?=\n[A-Z][a-z]|\n\n|$)/gi,
          /DKIM Result:[\s\S]*?(?=\n[A-Z][a-z]|\n\n|$)/gi,
          /DMARC (?:Result|Policy|Info):[\s\S]*?(?=\n[A-Z][a-z]|\n\n|$)/gi,
          /BIMI Location:[\s\S]*?(?=\n[A-Z][a-z]|\n\n|$)/gi,
          /Message ID:[\s\S]*?(?=\n[A-Z][a-z]|\n\n|$)/gi,

          // Full email headers section (if exists as a block)
          /View Full Email Headers[\s\S]*?(?=\n\n[A-Z]|$)/gi,

          // Long technical IDs and hashes
          /[a-f0-9]{32,}/gi, // Replace long hex strings with placeholder
        ];

        let trimmed = text;

        // Remove verbose sections
        for (const pattern of verbosePatterns) {
          trimmed = trimmed.replace(pattern, '');
        }

        // Clean up excessive whitespace
        trimmed = trimmed.replace(/\n{3,}/g, '\n\n').trim();

        // If we removed too much (>60% of original), return original
        // This prevents breaking non-email messages
        if (trimmed.length < text.length * 0.4) {
          return text;
        }

        return trimmed.length > 0 ? trimmed : text;
      } catch (e) {
        console.error('Trimming failed:', e);
        return text;
      }
    }

    // Trim verbose content before sending to AI (can be disabled via query param)
    const url = new URL(r.url);
    const skipTrimming = url.searchParams.get('verbose') === 'true';
    const processedPayload = skipTrimming ? payload : trimVerboseContent(payload);

    // 5. Process Message (LLM formatting to Rich Discord Embed)
    async function getDiscordEmbed(text) {
      const models = [
        "z-ai/glm-4.5-air:free",
        "arcee-ai/trinity-mini:free",
      ];

      // Fallback structure
      const fallback = {
        title: "🔔 Notification",
        description: text.substring(0, 2000), // Safety clip
        color: 9807270, // Grey
        footer: { text: "Processed via Worker (Fallback)" },
        timestamp: new Date().toISOString()
      };

      for (const model of models) {
        try {
          const resp = await retryWithBackoff(async () => {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${openrouterKey}`,
                "HTTP-Referer": "https://yourdomain.com",
                "X-Title": "discord-worker"
              },
              body: JSON.stringify({
                model,
                messages: [
                {
                  role: "system",
                  content: `You are a Discord notification formatter. Create concise, readable notifications from any input source.

                  Rules:
                  1. **Title**: Short event summary (max 60 chars). Start with emoji: 🚨 error, ✅ success, ⚠️ warning, 📦 info, 🔔 general.
                  2. **Description**: 1-2 sentences max (200 chars). Answer: What happened? Skip technical jargon.
                  3. **Fields**: Only 3-4 CRITICAL fields. Choose from:
                     - Event/Action type
                     - Who/What (user, device, service)
                     - When (if time is critical)
                     - Where (location, IP, endpoint)
                     - Status/Result

                     SKIP: Technical IDs, hashes, authentication results, email routing, headers, long URLs, verbose logs.
                     Format: { "name": "Key", "value": "Short value", "inline": true }

                  4. **Color**: 5763719=green(success), 16776960=yellow(warning), 15548997=red(error), 3447003=blue(info)

                  5. **Be ruthless**: If a field isn't immediately actionable or meaningful to a human, SKIP IT.

                  Output ONLY this JSON:
                  {
                    "title": "🔔 Event Name",
                    "description": "Brief explanation",
                    "color": 5763719,
                    "fields": [ { "name": "Key", "value": "Value", "inline": true } ],
                    "footer": { "text": "Notification" }
                  }`
                },
                { role: "user", content: text }
              ],
              response_format: { type: "json_object" }
              })
            });
            if (!response.ok) {
              throw new Error(`API returned ${response.status}`);
            }
            return response;
          });

          if (!resp.ok) continue;

          const data = await resp.json();
          let content = data?.choices?.[0]?.message?.content?.trim();

          if (content) {
            // cleanup markdown blocks if LLM adds them despite instructions
            content = content.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '');
            const parsed = JSON.parse(content);

            // Add timestamp client-side to ensure accuracy
            parsed.timestamp = new Date().toISOString();
            return parsed;
          }
        } catch (e) {
          console.error(`Model ${model} failed:`, e);
          continue;
        }
      }
      return fallback;
    }

    const embed = await getDiscordEmbed(processedPayload);

    // 6. Select avatar based on notification type
    function getAvatarUrl(color) {
      const avatars = {
        5763719: "https://cdn-icons-png.flaticon.com/512/190/190411.png",  // Green - Success/Check
        3447003: "https://cdn-icons-png.flaticon.com/512/2965/2965279.png", // Blue - Info
        16776960: "https://cdn-icons-png.flaticon.com/512/564/564619.png",  // Yellow - Warning
        15548997: "https://cdn-icons-png.flaticon.com/512/564/564593.png",  // Red - Error/Alert
        9807270: "https://cdn-icons-png.flaticon.com/512/4712/4712109.png"  // Grey - Default/Notification
      };
      return avatars[color] || avatars[9807270]; // Default to grey notification icon
    }

    // 7. Send to Discord Webhook with retry
    const res = await retryWithBackoff(async () => {
      const response = await fetch(discordUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "System Alerts",
          avatar_url: getAvatarUrl(embed.color),
          embeds: [embed]
        })
      });

      if (!response.ok) {
        const txt = await response.text();
        console.log("Discord Payload:", JSON.stringify(embed)); // Debugging help
        throw new Error(`Discord webhook failed: ${response.status} - ${txt}`);
      }

      return response;
    }).catch(error => {
      console.error("Discord webhook failed after retries:", error);
      return new Response(`Discord error: ${error.message}`, { status: 500 });
    });

    if (res instanceof Response && res.status === 500) {
      return res;
    }

    return new Response("Sent to Discord!", { status: 200 });
  }
};
