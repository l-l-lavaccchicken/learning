const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- CONFIG: change these before you rely on this for anything ----
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace-this-with-something-random';
// ---------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, 'data');
const GAMES_DIR = path.join(__dirname, 'games');
const GAMES_JSON = path.join(DATA_DIR, 'games.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(GAMES_DIR)) fs.mkdirSync(GAMES_DIR, { recursive: true });
if (!fs.existsSync(GAMES_JSON)) fs.writeFileSync(GAMES_JSON, '[]');

function loadGames() {
  try {
    return JSON.parse(fs.readFileSync(GAMES_JSON, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveGames(games) {
  fs.writeFileSync(GAMES_JSON, JSON.stringify(games, null, 2));
}

function slugify(name) {
  const base = path.basename(name, path.extname(name));
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
}

// --- middleware ---
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  })
);

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Not authorized' });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, GAMES_DIR),
    filename: (req, file, cb) => {
      if (path.extname(file.originalname).toLowerCase() !== '.html') {
        return cb(new Error('Only .html files are allowed'));
      }
      const id = crypto.randomUUID().slice(0, 8);
      cb(null, `${slugify(file.originalname)}-${id}.html`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.html') {
      return cb(new Error('Only .html files are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per game file
});

// --- static files ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/games', express.static(GAMES_DIR));

// --- public API ---
app.get('/api/games', (req, res) => {
  res.json(loadGames());
});

// --- admin auth ---
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Wrong password' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/check', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// --- admin: add a game (upload an html file + title) ---
app.post('/api/admin/games', requireAdmin, (req, res) => {
  upload.single('gamefile')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const title = (req.body.title || req.file.originalname).slice(0, 80);
    const games = loadGames();
    const entry = {
      id: crypto.randomUUID(),
      title,
      filename: req.file.filename,
      addedAt: new Date().toISOString(),
    };
    games.push(entry);
    saveGames(games);
    res.json({ ok: true, game: entry });
  });
});

// --- admin: delete a game ---
app.delete('/api/admin/games/:id', requireAdmin, (req, res) => {
  const games = loadGames();
  const idx = games.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = games.splice(idx, 1);
  saveGames(games);
  const filePath = path.join(GAMES_DIR, removed.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`BrightPath Learning running at http://localhost:${PORT}`);
});
