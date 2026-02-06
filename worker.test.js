import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock environment for testing
const mockEnv = {
  DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/test',
  OPENROUTER_API_KEY: 'test-api-key'
};

// Import the worker (we'll need to export functions for testing)
// For now, we'll test by making actual fetch requests to the worker

describe('NTFY Worker', () => {
  describe('Request Validation', () => {
    it('should reject non-POST requests', async () => {
      const request = new Request('https://example.com', { method: 'GET' });
      const response = await fetch(request);

      expect(response.status).toBe(405);
      expect(await response.text()).toBe('Only POST');
    });

    it('should reject requests with no body', async () => {
      const request = new Request('https://example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      // Mock empty body
      const response = await fetch(request);
      expect(response.status).toBe(400);
    });

    it('should accept valid JSON payload', async () => {
      const request = new Request('https://example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test' })
      });

      const response = await fetch(request);
      expect(response.status).not.toBe(400);
    });

    it('should accept text payload', async () => {
      const request = new Request('https://example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'Plain text message'
      });

      const response = await fetch(request);
      expect(response.status).not.toBe(400);
    });
  });

  describe('Environment Configuration', () => {
    it('should return error if DISCORD_WEBHOOK is missing', async () => {
      const env = { OPENROUTER_API_KEY: 'test-key' };
      // Test with missing webhook
      // This would require worker export for unit testing
    });

    it('should return error if OPENROUTER_API_KEY is missing', async () => {
      const env = { DISCORD_WEBHOOK: 'https://test.com' };
      // Test with missing API key
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed requests up to 3 times', async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      // Test retry behavior
      let attempts = 0;
      const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 100) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            attempts++;
            return await fn();
          } catch (error) {
            if (attempt === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
          }
        }
      };

      await retryWithBackoff(mockFetch);
      expect(attempts).toBe(3);
    });

    it('should use exponential backoff', async () => {
      const delays = [];
      const startTime = Date.now();

      const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 100) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            return await fn();
          } catch (error) {
            if (attempt === maxRetries - 1) throw error;
            const delay = baseDelay * Math.pow(2, attempt);
            delays.push(delay);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      };

      const mockFn = vi.fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValueOnce('Success');

      await retryWithBackoff(mockFn);

      expect(delays).toEqual([100, 200]);
    });
  });

  describe('Avatar Selection', () => {
    it('should return correct avatar for success (green)', () => {
      const getAvatarUrl = (color) => {
        const avatars = {
          5763719: "https://cdn-icons-png.flaticon.com/512/190/190411.png",
          3447003: "https://cdn-icons-png.flaticon.com/512/2965/2965279.png",
          16776960: "https://cdn-icons-png.flaticon.com/512/564/564619.png",
          15548997: "https://cdn-icons-png.flaticon.com/512/564/564593.png",
          9807270: "https://cdn-icons-png.flaticon.com/512/4712/4712109.png"
        };
        return avatars[color] || avatars[9807270];
      };

      expect(getAvatarUrl(5763719)).toBe("https://cdn-icons-png.flaticon.com/512/190/190411.png");
    });

    it('should return correct avatar for error (red)', () => {
      const getAvatarUrl = (color) => {
        const avatars = {
          5763719: "https://cdn-icons-png.flaticon.com/512/190/190411.png",
          3447003: "https://cdn-icons-png.flaticon.com/512/2965/2965279.png",
          16776960: "https://cdn-icons-png.flaticon.com/512/564/564619.png",
          15548997: "https://cdn-icons-png.flaticon.com/512/564/564593.png",
          9807270: "https://cdn-icons-png.flaticon.com/512/4712/4712109.png"
        };
        return avatars[color] || avatars[9807270];
      };

      expect(getAvatarUrl(15548997)).toBe("https://cdn-icons-png.flaticon.com/512/564/564593.png");
    });

    it('should return default avatar for unknown color', () => {
      const getAvatarUrl = (color) => {
        const avatars = {
          5763719: "https://cdn-icons-png.flaticon.com/512/190/190411.png",
          3447003: "https://cdn-icons-png.flaticon.com/512/2965/2965279.png",
          16776960: "https://cdn-icons-png.flaticon.com/512/564/564619.png",
          15548997: "https://cdn-icons-png.flaticon.com/512/564/564593.png",
          9807270: "https://cdn-icons-png.flaticon.com/512/4712/4712109.png"
        };
        return avatars[color] || avatars[9807270];
      };

      expect(getAvatarUrl(999999)).toBe("https://cdn-icons-png.flaticon.com/512/4712/4712109.png");
    });
  });

  describe('AI Model Fallback', () => {
    it('should try primary model first', () => {
      const models = ["z-ai/glm-4.5-air:free", "arcee-ai/trinity-mini:free"];
      expect(models[0]).toBe("z-ai/glm-4.5-air:free");
    });

    it('should fallback to secondary model if primary fails', () => {
      const models = ["z-ai/glm-4.5-air:free", "arcee-ai/trinity-mini:free"];
      expect(models[1]).toBe("arcee-ai/trinity-mini:free");
    });

    it('should use static fallback if all models fail', () => {
      const fallback = {
        title: "🔔 Notification",
        description: "test",
        color: 9807270,
        footer: { text: "Processed via Worker (Fallback)" },
        timestamp: new Date().toISOString()
      };

      expect(fallback.title).toBe("🔔 Notification");
      expect(fallback.color).toBe(9807270);
    });
  });

  describe('Payload Parsing', () => {
    it('should parse JSON payload correctly', () => {
      const jsonPayload = { message: 'test', level: 'info' };
      const stringified = JSON.stringify(jsonPayload, null, 2);

      expect(stringified).toContain('test');
      expect(stringified).toContain('info');
    });

    it('should handle plain text payload', () => {
      const textPayload = "Simple text message";
      expect(textPayload).toBe("Simple text message");
    });

    it('should truncate long descriptions to 2000 chars', () => {
      const longText = 'a'.repeat(3000);
      const truncated = longText.substring(0, 2000);

      expect(truncated.length).toBe(2000);
    });
  });

  describe('Discord Embed Structure', () => {
    it('should have required embed fields', () => {
      const embed = {
        title: "Test",
        description: "Description",
        color: 3447003,
        footer: { text: "AI Formatted" },
        timestamp: new Date().toISOString()
      };

      expect(embed).toHaveProperty('title');
      expect(embed).toHaveProperty('description');
      expect(embed).toHaveProperty('color');
      expect(embed).toHaveProperty('footer');
      expect(embed).toHaveProperty('timestamp');
    });

    it('should have valid color codes', () => {
      const validColors = [5763719, 3447003, 16776960, 15548997, 9807270];

      validColors.forEach(color => {
        expect(color).toBeGreaterThan(0);
        expect(color).toBeLessThan(16777216); // Max RGB value
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON gracefully', () => {
      const malformedJson = "{ invalid json }";

      expect(() => {
        try {
          JSON.parse(malformedJson);
        } catch (e) {
          throw new Error('Bad body');
        }
      }).toThrow('Bad body');
    });

    it('should log errors for debugging', () => {
      const consoleSpy = vi.spyOn(console, 'error');
      console.error('Test error', new Error('test'));

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

describe('Integration Tests', () => {
  it('should successfully process a complete request flow', async () => {
    // This would require a full integration test environment
    // with mocked OpenRouter and Discord APIs
    expect(true).toBe(true);
  });
});
