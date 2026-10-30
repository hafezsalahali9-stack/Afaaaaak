const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = process.env.PORT || 3000;

const ELEVEN_API_KEY = (process.env.ELEVEN_API_KEY || "").trim();
const REPLICATE_API_TOKEN = (process.env.REPLICATE_API_TOKEN || "").trim();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// تنزيل ملف من رابط وحفظه محلياً
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// 1. بدء المهمة لتفادي مهلة الـ 100 ثانية
app.post('/api/start-production', async (req, res) => {
  try {
    const { imageBase64, productName, offer, script, voiceId, musicType, customMusicBase64 } = req.body;

    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: 'يرجى إضافة REPLICATE_API_TOKEN في إعدادات Render' });
    }
    if (!imageBase64) {
      return res.status(400).json({ error: 'يرجى رفع صورة المنتج أولاً.' });
    }
    if (!script) {
      return res.status(400).json({ error: 'يرجى كتابة نص السيناريو.' });
    }

    const taskId = 'job_' + Date.now();
    const taskDir = path.join(TEMP_DIR, taskId);
    fs.mkdirSync(taskDir, { recursive: true });

    // 1. إرسال طلب توليد الصوت البشري الواقعي (ElevenLabs)
    const voicePromise = (async () => {
      if (!ELEVEN_API_KEY) return null;
      const targetVoice = voiceId || 'nPczCjzI2devNBz1zQrb'; // صوت إعلاني فخم
      const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}`, {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVEN_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: script,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.40,
            similarity_boost: 0.88,
            style: 0.40,
            use_speaker_boost: true
          }
        })
      });
      if (ttsResp.ok) {
        const audioBuf = await ttsResp.arrayBuffer();
        const voicePath = path.join(taskDir, 'voice.mp3');
        fs.writeFileSync(voicePath, Buffer.from(audioBuf));
        return voicePath;
      }
      return null;
    })();

    // 2. إرسال طلب الفيديو إلى Replicate
    const videoPrompt = `Cinematic commercial video showcase, professional model holding and gracefully displaying ${productName || 'luxury product'} close-up to camera, elegant luxury studio lighting, 4k ultra-detailed, slow motion, crisp reflections, realistic textures.`;

    const repResp = await fetch('https://api.replicate.com/v1/models/minimax/video-01/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: {
          prompt: videoPrompt,
          first_frame_image: imageBase64,
          prompt_optimizer: true
        }
      })
    });

    const prediction = await repResp.json();
    if (!repResp.ok || prediction.error) {
      return res.status(repResp.status || 500).json({
        error: prediction.detail || prediction.error || 'خطأ في استدعاء Replicate'
      });
    }

    // حفظ ملف الموسيقى إن وجد
    if (customMusicBase64) {
      const musicPath = path.join(taskDir, 'custom_music.mp3');
      const base64Data = customMusicBase64.replace(/^data:audio\/\w+;base64,/, '');
      fs.writeFileSync(musicPath, Buffer.from(base64Data, 'base64'));
    }

    // حفظ بيانات المهمة
    const taskData = {
      id: taskId,
      predictionId: prediction.id,
      productName,
      offer,
      musicType: musicType || 'luxury',
      status: 'processing',
      created: Date.now()
    };
    fs.writeFileSync(path.join(taskDir, 'task.json'), JSON.stringify(taskData));

    // انتظار الصوت بالخلفية
    voicePromise.then(() => {}).catch(console.error);

    return res.json({ success: true, taskId, predictionId: prediction.id });

  } catch (err) {
    console.error('Start Production Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 2. فحص حالة المهمة وتجميع الفيديو فور اكتمال Replicate
app.get('/api/check-task-status', async (req, res) => {
  try {
    const { taskId, predictionId } = req.query;
    if (!taskId || !predictionId) return res.status(400).json({ error: 'Missing parameters' });

    const taskDir = path.join(TEMP_DIR, taskId);
    const taskJsonPath = path.join(taskDir, 'task.json');

    if (!fs.existsSync(taskJsonPath)) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const taskData = JSON.parse(fs.readFileSync(taskJsonPath, 'utf8'));

    if (taskData.status === 'completed') {
      return res.json({ status: 'completed', videoUrl: `/api/download-ad?taskId=${taskId}` });
    }
    if (taskData.status === 'failed') {
      return res.json({ status: 'failed', error: taskData.error || 'فشلت معالجة الإعلان' });
    }

    // فحص حالة Replicate
    const checkResp = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
    });
    const prediction = await checkResp.json();

    if (prediction.status === 'succeeded' && prediction.output) {
      const rawVideoUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      
      // بدء عملية المونتاج والدمج بـ FFmpeg
      taskData.status = 'rendering_ffmpeg';
      fs.writeFileSync(taskJsonPath, JSON.stringify(taskData));

      processVideoWithFFmpeg(taskId, rawVideoUrl, taskData)
        .then(() => {
          taskData.status = 'completed';
          fs.writeFileSync(taskJsonPath, JSON.stringify(taskData));
        })
        .catch((err) => {
          console.error('FFmpeg render error:', err);
          taskData.status = 'failed';
          taskData.error = err.message;
          fs.writeFileSync(taskJsonPath, JSON.stringify(taskData));
        });

      return res.json({ status: 'rendering_ffmpeg', message: 'جاري دمج الصوت البشري والموسيقى والمؤثرات...' });
    } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
      taskData.status = 'failed';
      taskData.error = prediction.error || 'فشلت معالجة المشهد في Replicate';
      fs.writeFileSync(taskJsonPath, JSON.stringify(taskData));
      return res.json({ status: 'failed', error: taskData.error });
    } else {
      return res.json({ status: 'processing', message: 'جاري توليد المشاهد البصرية...' });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// دمج الفيديو والمونتاج بواسطة FFmpeg على السيرفر
async function processVideoWithFFmpeg(taskId, rawVideoUrl, taskData) {
  const taskDir = path.join(TEMP_DIR, taskId);
  const rawVideoPath = path.join(taskDir, 'raw.mp4');
  const voicePath = path.join(taskDir, 'voice.mp3');
  const customMusicPath = path.join(taskDir, 'custom_music.mp3');
  const outputAdPath = path.join(taskDir, 'final_ad.mp4');

  await downloadFile(rawVideoUrl, rawVideoPath);

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg();

    // 1. إدخال الفيديو الخام وجعله يتكرر (Loop) بسلاسة ليصل إلى 15 ثانية كاملة
    cmd.input(rawVideoPath).inputOptions(['-stream_loop', '3']);

    // 2. إدخال الصوت البشري
    let hasVoice = fs.existsSync(voicePath);
    if (hasVoice) {
      cmd.input(voicePath);
    }

    // 3. إدخال الموسيقى (إما المرفوعة أو رنة مدمجة)
    let hasCustomMusic = fs.existsSync(customMusicPath);
    if (hasCustomMusic) {
      cmd.input(customMusicPath).inputOptions(['-stream_loop', '-1']);
    }

    // بناء فلاتر الصوت والمونتاج (تخفيض صوت الموسيقى 20% ليبقى الصوت البشري عالياً وواضحاً)
    let filterComplex = [];
    if (hasVoice && hasCustomMusic) {
      filterComplex.push('[1:a]volume=1.0[v_audio]');
      filterComplex.push('[2:a]volume=0.22[m_audio]');
      filterComplex.push('[v_audio][m_audio]amix=inputs=2:duration=first:dropout_transition=2[a_out]');
      cmd.complexFilter(filterComplex).outputOptions(['-map', '0:v', '-map', '[a_out]']);
    } else if (hasVoice) {
      cmd.outputOptions(['-map', '0:v', '-map', '1:a']);
    } else if (hasCustomMusic) {
      cmd.outputOptions(['-map', '0:v', '-map', '1:a']);
    }

    cmd
      .outputOptions([
        '-t', '15', // مدة الإعلان 15 ثانية بالتمام والكمال
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'fast',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart'
      ])
      .save(outputAdPath)
      .on('end', () => resolve(outputAdPath))
      .on('error', (err) => reject(err));
  });
}

// تنزيل الإعلان النهائي المتكامل
app.get('/api/download-ad', (req, res) => {
  const { taskId } = req.query;
  const filePath = path.join(TEMP_DIR, taskId, 'final_ad.mp4');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="Full_Commercial_Ad_15s.mp4"');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.status(404).send('الفيديو غير جاهز بعد أو انتهت صلاحيته.');
  }
});

app.listen(PORT, () => {
  console.log(`Fareq Studio Pro online on port ${PORT}`);
});
