export default {
  async fetch(r, e) {
    // 1. Check method
    if (r.method !== "POST") {
      return new Response("Only POST", { status: 405, headers: { Allow: "POST" } });
    }

    // 2. Validate Configuration
    const discordUrl = e.DISCORD_WEBHOOK?.trim();
    if (!discordUrl) {
      return new Response("Error: Missing DISCORD_WEBHOOK_URL environment variable.", { status: 500 });
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
          const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
                  content: `You are an expert Discord notification formatter. Analyze the input log or message and structure it into a beautiful, high-readability JSON Embed.

                  Rules:
                  1. **Title**: Summarize the event (max 256 chars). Start with a relevant Emoji (e.g., 🚨 for errors, ✅ for success, 📦 for data).
                  2. **Description**: Provide the main context in Markdown (max 2000 chars). Use **bold** for emphasis.
                  3. **Fields**: CRITICAL. If the input has structured data (IDs, IP addresses, Status Codes, Keys, Usernames), extract them into the 'fields' array.
                     - Format: { "name": "Field Name", "value": "Field Value", "inline": true }
                     - Use 'inline': true for short data to create columns.
                  4. **Color**:
                     - Success/Info: 5763719 (Green)
                     - Warning: 16776960 (Yellow)
                     - Error/Critical: 15548997 (Red)
                     - Default: 3447003 (Blue)

                  Output ONLY raw JSON with this structure:
                  {
                    "title": "...",
                    "description": "...",
                    "color": 12345,
                    "fields": [ { "name": "...", "value": "...", "inline": true } ],
                    "footer": { "text": "AI Formatted" }
                  }`
                },
                { role: "user", content: text }
              ],
              response_format: { type: "json_object" }
            })
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

    const embed = await getDiscordEmbed(payload);

    // 6. Send to Discord Webhook
    const res = await fetch(discordUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "System Alerts",
        avatar_url: "https://cdn-icons-png.flaticon.com/512/4712/4712109.png",
        embeds: [embed]
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      console.log("Discord Payload:", JSON.stringify(embed)); // Debugging help
      return new Response(`Discord error: ${res.status} - ${txt}`, { status: 500 });
    }

    return new Response("Sent to Discord!", { status: 200 });
  }
};
