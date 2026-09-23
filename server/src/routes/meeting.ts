import { Router } from 'express';
import { loadOpenAIKey } from '../services/openaiAgent';

const router = Router();

// POST /api/meeting/session
// OpenAI: exchanges the server-side API key for a short-lived ephemeral token so
//         the client can open a direct WebSocket to the Realtime API without
//         exposing the key in the browser.
// Gemini: no ephemeral token API exists — client should use the /meeting/relay WS.
router.post('/meeting/session', async (req, res) => {
  const { provider } = req.body as { provider: string };

  if (!provider) return res.status(400).json({ error: 'Missing provider' });

  try {
    if (provider === 'openai') {
      const apiKey = await loadOpenAIKey();
      const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gpt-4o-realtime-preview', voice: 'verse' }),
      });
      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: err });
      }
      const data = await response.json() as {
        id: string;
        client_secret: { value: string; expires_at: number };
      };
      return res.json({
        provider: 'openai',
        sessionId: data.id,
        clientSecret: data.client_secret.value,
      });

    } else if (provider === 'google') {
      // Gemini Live has no ephemeral token endpoint — proxy through /meeting/relay.
      return res.json({ provider: 'google', useRelay: true });

    } else {
      return res.status(400).json({ error: `Provider '${provider}' does not support live meetings` });
    }
  } catch (err) {
    console.error('[Meeting/Session]', err);
    return res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
