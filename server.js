const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

puppeteer.use(StealthPlugin());

const app = express();
app.set('trust proxy', 1); // Necessario per Render per capire se siamo in https
app.use(helmet());
app.use(cors());
app.use(express.json());

// 1. Protezione anti-Spam (Rate Limiting per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 30, // Massimo 30 richieste per IP ogni 15 minuti
  message: { error: 'Troppe richieste da questo IP, riprova più tardi. (Protezione anti-DDoS attiva)' }
});
app.use('/api/', apiLimiter);

// 2. Protezione anti-RAM Exhaustion (Limite server)
let activeBrowsers = 0;
const MAX_CONCURRENT_BROWSERS = 2;

const BASE_URL = 'https://streamingcommunityz.systems';

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query mancante' });

  if (activeBrowsers >= MAX_CONCURRENT_BROWSERS) {
    return res.status(503).json({ error: 'Sistema al momento sovraccarico (Protezione RAM Server). Riprova tra 10 secondi.' });
  }
  activeBrowsers++;

  try {
    const browser = await puppeteer.launch({ 
      headless: true, 
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-web-security', '--no-zygote', '--single-process'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    
    const searchUrl = `${BASE_URL}/it/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('a[href*="/titles/"]', { timeout: 8000 }).catch(() => {});
    
    const results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('a[href*="/titles/"]'));
      const uniqueItems = [];
      const seenUrls = new Set();
      
      items.forEach(linkEl => {
        const url = linkEl.href;
        if (seenUrls.has(url)) return;
        seenUrls.add(url);
        
        const imgEl = linkEl.querySelector('img');
        const titleDiv = linkEl.querySelector('.title, .name, h2, h3, .movie-title');
        let titleEl = titleDiv ? titleDiv.innerText.trim() : linkEl.innerText.trim();
        if (!titleEl && imgEl) titleEl = imgEl.alt;
        if (!titleEl) titleEl = 'Senza Titolo';

        uniqueItems.push({ title: titleEl, url: url, image: imgEl ? imgEl.src : null });
      });
      return uniqueItems;
    });

    await browser.close();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Errore durante la ricerca.', details: error.message });
  } finally {
    activeBrowsers--;
  }
});

app.get('/api/extract', async (req, res) => {
  const movieUrl = req.query.url;
  if (!movieUrl) return res.status(400).json({ error: 'Url mancante' });

  if (activeBrowsers >= MAX_CONCURRENT_BROWSERS) {
    return res.status(503).json({ error: 'Sistema al momento sovraccarico (Protezione RAM Server). Riprova tra 10 secondi.' });
  }
  activeBrowsers++;

  console.log(`\n[EXTRACT] Avvio estrazione per: ${movieUrl}`);

  try {
    const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-web-security', '--no-zygote', '--single-process', '--disable-features=IsolateOrigins,site-per-process']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    
    let videoLink = null;
    await page.setRequestInterception(true);
    
    page.on('request', request => {
      const url = request.url();
      if ((url.includes('.m3u8') || url.includes('.mp4') || url.includes('master.json') || url.includes('playlist')) && !url.includes('trailer')) {
         if (!videoLink) {
             videoLink = url;
             console.log(`[EXTRACT] ✅ Link Video Catturato! -> ${videoLink.substring(0, 80)}...`);
         }
      }
      request.continue();
    });

    console.log(`[EXTRACT] Passo 1: Apro pagina di presentazione...`);
    await page.goto(movieUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    console.log(`[EXTRACT] Passo 2: Cerco il bottone "Guarda"...`);
    try {
        await page.waitForSelector('a[href*="/watch/"], a[href*="/iframe/"]', { timeout: 8000 });
        const watchUrl = await page.evaluate(() => {
            const btn = document.querySelector('a[href*="/watch/"], a[href*="/iframe/"]');
            return btn ? btn.href : null;
        });
        
        if (watchUrl) {
             console.log(`[EXTRACT] Passo 3: Navigo verso il player interno: ${watchUrl}`);
             await page.goto(watchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
             
             console.log(`[EXTRACT] Passo 4: Controllo l'Iframe...`);
             await page.waitForSelector('iframe', { timeout: 5000 }).catch(() => {});
             
             // Aspettiamo per far sì che vue popoli l'iframe
             await new Promise(r => setTimeout(r, 3000));
             
             const iframeUrl = await page.evaluate(() => {
                 const iframe = document.querySelector('iframe');
                 return iframe ? iframe.src : null;
             });
             
             if (iframeUrl && iframeUrl !== '') {
                 console.log(`[EXTRACT] Trovato Iframe: ${iframeUrl}, ci entro...`);
                 await page.goto(iframeUrl, { waitUntil: 'networkidle2', timeout: 30000 });
             } else {
                 console.log(`[EXTRACT] L'Iframe non ha src o non c'è, continuo...`);
             }
        }
    } catch(e) {
        console.log(`[EXTRACT] Nessun link /watch/ trovato. Proseguo.`);
    }
    
    console.log(`[EXTRACT] Passo 5: Tento di avviare il video...`);
    await new Promise(r => setTimeout(r, 4000)); 
    
    // Proviamo a cliccare ovunque possa esserci un bottone
    try {
        // Clicchiamo al centro esatto della pagina, perché nei player esterni il tasto play è enorme al centro
        const { width, height } = await page.viewport();
        await page.mouse.click(width / 2, height / 2);
        console.log(`[EXTRACT] Cliccato al centro dello schermo.`);
        await new Promise(r => setTimeout(r, 3000)); 
        
        // Magari è richiesto un secondo click per togliere il pop-up
        await page.mouse.click(width / 2, height / 2);
        console.log(`[EXTRACT] Cliccato di nuovo al centro dello schermo.`);
        await new Promise(r => setTimeout(r, 5000));
    } catch(e) {
        console.log(`[EXTRACT] Errore nel click.`);
    }

    await browser.close();
    
    if (videoLink) {
        console.log(`[EXTRACT] Estrazione conclusa con SUCCESSO! Passaggio al Proxy...`);
        // Modifica: Passiamo il link attraverso il nostro Proxy per bypassare il blocco IP!
        const proxyUrl = `https://${req.get('host')}/api/proxy?url=${encodeURIComponent(videoLink)}`;
        res.json({ videoUrl: proxyUrl });
    } else {
        console.log(`[EXTRACT] ❌ Estrazione FALLITA.`);
        res.status(404).json({ error: 'Nessun link video rilevato. Il sito usa un player troppo protetto (es. HLS tokenizzato).' });
    }
  } catch (error) {
    console.error(`[EXTRACT] ❌ Errore critico:`, error);
    res.status(500).json({ error: 'Errore durante l\'estrazione' });
  } finally {
    activeBrowsers--;
  }
});

// ----------------------------------------------------
// PROXY HLS (AGGIRAMENTO BLOCCO IP VIXCLOUD)
// ----------------------------------------------------
const { Readable } = require('stream');

app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Url mancante');

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Referer': BASE_URL,
        'Origin': BASE_URL
      }
    });

    if (!response.ok) {
       return res.status(response.status).send('Errore dal server video');
    }

    // Se è un file di playlist m3u8, dobbiamo riscrivere i link interni
    if (targetUrl.includes('.m3u8')) {
       let m3u8Content = await response.text();
       const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

       const lines = m3u8Content.split('\n');
       const rewrittenLines = lines.map(line => {
          if (line.trim() === '' || line.startsWith('#')) return line;
          let fullUrl = line;
          if (!line.startsWith('http')) {
             fullUrl = baseUrl + line;
          }
          return `https://${req.get('host')}/api/proxy?url=${encodeURIComponent(fullUrl)}`;
       });

       res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
       res.setHeader('Access-Control-Allow-Origin', '*');
       return res.send(rewrittenLines.join('\n'));
    }

    // Se è un pezzo di video (.ts, .mp4, ecc.), lo scarichiamo e lo passiamo al telefono
    res.setHeader('Content-Type', response.headers.get('content-type') || 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    Readable.fromWeb(response.body).pipe(res);

  } catch (err) {
    console.error('[PROXY ERROR]', err.message);
    res.status(500).send('Proxy error');
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend StreamingCommunity in ascolto su porta ${PORT}`);
});
