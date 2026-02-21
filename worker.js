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

    // 3. Validate AI Key
    const openrouterKey = e.OPENROUTER_API_KEY?.trim();
    if (!openrouterKey) {
      return new Response("Missing OPENROUTER_API_KEY env", { status: 500 });
    }

    // 4. Parse Body
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

    // 4a. Smart payload trimming - Remove verbose technical details
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
          /[a-f0-9]{32,}/gi,
        ];

        let trimmed = text;

        // Remove verbose sections
        for (const pattern of verbosePatterns) {
          trimmed = trimmed.replace(pattern, '');
        }

        // Clean up excessive whitespace
        trimmed = trimmed.replace(/\n{3,}/g, '\n\n').trim();

        // If we removed too much (>60% of original), return original
        if (trimmed.length < text.length * 0.4) {
          return text;
        }

        return trimmed.length > 0 ? trimmed : text;
      } catch (e) {
        console.error('Trimming failed:', e);
        return text;
      }
    }

    const url = new URL(r.url);
    const skipTrimming = url.searchParams.get('verbose') === 'true';
    const processedPayload = skipTrimming ? payload : trimVerboseContent(payload);

    // 5. Process Message (LLM formatting for ntfy notification)
    async function getNtfyNotification(text) {
      const models = [
        "z-ai/glm-4.5-air:free",
        "arcee-ai/trinity-mini:free",
      ];

      // Fallback structure
      const fallback = {
        title: "Notification",
        message: text.substring(0, 4096),
        priority: "default",
        tags: "bell"
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
                "X-Title": "ntfy-worker"
              },
              body: JSON.stringify({
                model,
                messages: [
                  {
                    role: "system",
                    content: `You are a notification formatter for ntfy. Create concise, readable notifications from any input.

Rules:
1. **title**: Short event summary (max 60 chars). No emoji here.
2. **message**: 1-3 sentences max. What happened? Skip technical jargon.
3. **priority**: One of: "urgent" (critical errors/outages), "high" (warnings/failures), "default" (info), "low" (minor events), "min" (background).
4. **tags**: One ntfy tag shortcode (e.g. "rotating_light" for errors, "white_check_mark" for success, "warning" for warnings, "information_source" for info, "bell" for general).

Output ONLY this JSON:
{
  "title": "Event Name",
  "message": "Brief explanation",
  "priority": "default",
  "tags": "bell"
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
            return JSON.parse(content);
          }
        } catch (e) {
          console.error(`Model ${model} failed:`, e);
          continue;
        }
      }
      return fallback;
    }

    const notification = await getNtfyNotification(processedPayload);

    // 6. Send to ntfy
    const NTFY_TOPIC = "fupvaK-6nytti-hopmyc";

    const res = await retryWithBackoff(async () => {
      const response = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "Title": notification.title || "Notification",
          "Priority": notification.priority || "default",
          "Tags": notification.tags || "bell"
        },
        body: notification.message || processedPayload.substring(0, 4096)
      });

      if (!response.ok) {
        const txt = await response.text();
        console.log("ntfy Payload:", JSON.stringify(notification)); // Debugging help
        throw new Error(`ntfy failed: ${response.status} - ${txt}`);
      }

      return response;
    }).catch(error => {
      console.error("ntfy publish failed after retries:", error);
      return new Response(`ntfy error: ${error.message}`, { status: 500 });
    });

    if (res instanceof Response && res.status === 500) {
      return res;
    }

    return new Response("Sent to ntfy!", { status: 200 });
  }
};
