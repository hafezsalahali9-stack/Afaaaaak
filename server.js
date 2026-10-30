const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DID_AUTH = process.env.DID_AUTH || "WjI5dloyeGxMVzloZFhSb01ud3hNREF5TlRjd05UZzFNVGN6TVRnMk5EYzNNemhBWVd0ZlFuSkhWWEZKYkVSMU5FUkVXa0ppV0dnek1XODM6YnBzX3hBb0QyUlVTQ3NVVGJTMHJs";

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to generate video with D-ID
app.post('/api/generate-video', async (req, res) => {
  try {
    const { avatarUrl, script, voiceId } = req.body;

    if (!script) {
      return res.status(400).json({ error: 'يرجى كتابة نص السيناريو أولاً.' });
    }

    const didHeaders = {
      'Authorization': `Basic ${DID_AUTH}`,
      'Content-Type': 'application/json'
    };

    // Clean payload strictly adhering to D-ID Talk API schema
    const payload = {
      source_url: avatarUrl || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/master-ball.png',
      script: {
        type: 'text',
        input: script,
        provider: {
          type: 'microsoft',
          voice_id: voiceId || 'ar-SA-HamedNeural'
        }
      }
    };

    console.log('Sending payload to D-ID:', JSON.stringify(payload));

    const createRes = await fetch('https://api.d-id.com/talks', {
      method: 'POST',
      headers: didHeaders,
      body: JSON.stringify(payload)
    });

    const createData = await createRes.json();
    console.log('D-ID Response:', createData);

    if (!createRes.ok || !createData.id) {
      const detailedError = createData.description || createData.message || (createData.details ? JSON.stringify(createData.details) : 'فشل التحقق من البيانات');
      return res.status(createRes.status).json({ 
        error: `خطأ من D-ID: ${detailedError}`,
        details: createData 
      });
    }

    const talkId = createData.id;

    // Polling for completion
    let videoUrl = null;
    let attempts = 0;

    while (attempts < 25) {
      await new Promise(r => setTimeout(r, 2500));
      attempts++;

      const pollRes = await fetch(`https://api.d-id.com/talks/${talkId}`, {
        headers: didHeaders
      });

      const pollData = await pollRes.json();

      if (pollData.status === 'done' && pollData.result_url) {
        videoUrl = pollData.result_url;
        break;
      }

      if (pollData.status === 'error') {
        return res.status(500).json({ error: 'فشلت معالجة الفيديو في D-ID', details: pollData });
      }
    }

    if (!videoUrl) {
      return res.status(504).json({ error: 'استغرقت الرندرة وقتاً طويلاً، حاول مجدداً.' });
    }

    return res.json({ success: true, videoUrl });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/download-proxy', async (req, res) => {
  try {
    const { url, filename } = req.query;
    if (!url) return res.status(400).send('No URL provided');

    const videoResp = await fetch(url);
    if (!videoResp.ok) return res.status(videoResp.status).send('Video fetch error');

    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'Fareq_Ad.mp4'}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const arrayBuffer = await videoResp.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
