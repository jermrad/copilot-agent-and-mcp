const request = require('supertest');
const express = require('express');
const createApiRouter = require('../routes');
const path = require('path');

const fs = require('fs');
const writeJSON = require('../writeJSON');
const usersFile = path.join(__dirname, '../data/test-users.json');
const booksFile = path.join(__dirname, '../data/test-books.json');

// Helper to get a valid JWT
const jwt = require('jsonwebtoken');
const SECRET_KEY = 'test_secret';
function getToken(username = 'sandra') {
  return jwt.sign({ username }, SECRET_KEY, { expiresIn: '1h' });
}

const app = express();
app.use(express.json());
app.use('/api', createApiRouter({
  usersFile,
  booksFile,
  readJSON: (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [],
  writeJSON,
  authenticateToken: (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    try {
      req.user = jwt.verify(token, SECRET_KEY);
      next();
    } catch {
      return res.sendStatus(403);
    }
  },
  SECRET_KEY,
}));

describe('Favorites API', () => {
  it('GET /api/favorites should fail without auth', async () => {
    const res = await request(app).get('/api/favorites');
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/favorites should return favorites for valid user', async () => {
    const token = getToken('sandra');
    const res = await request(app)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/favorites should 404 for non-existent user', async () => {
    const token = getToken('nouser');
    const res = await request(app)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/favorites should add a book to favorites', async () => {
    const token = getToken('sandra');
    // Pick a book not already in favorites
    const books = JSON.parse(fs.readFileSync(booksFile, 'utf-8'));
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
    const sandra = users.find(u => u.username === 'sandra');
    const notFav = books.find(b => !sandra.favorites.includes(b.id));
    if (!notFav) return; // skip if all are favorites
    const res = await request(app)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookId: notFav.id });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/added/);
  });

  it('POST /api/favorites should not duplicate favorites', async () => {
    const token = getToken('sandra');
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
    const sandra = users.find(u => u.username === 'sandra');
    const alreadyFav = sandra.favorites[0];
    const res = await request(app)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookId: alreadyFav });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/added/);
  });

  it('POST /api/favorites should fail with missing bookId', async () => {
    const token = getToken('sandra');
    const res = await request(app)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/favorites should 404 for non-existent user', async () => {
    const token = getToken('nouser');
    const res = await request(app)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookId: '1' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/favorites should fail without auth', async () => {
    const res = await request(app)
      .post('/api/favorites')
      .send({ bookId: '1' });
    expect(res.statusCode).toBe(401);
  });

  describe('DELETE /api/favorites', () => {
    let originalUsers;

    beforeEach(() => {
      originalUsers = fs.readFileSync(usersFile, 'utf-8');
      const users = JSON.parse(originalUsers);
      users.find(u => u.username === 'sandra').favorites = [1, 2];
      writeJSON(usersFile, users);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      fs.writeFileSync(usersFile, originalUsers);
    });

    it('clears all favorites only for the authenticated user and persists the result', async () => {
      const before = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      const res = await request(app)
        .delete('/api/favorites')
        .set('Authorization', 'Bearer ' + getToken());

      expect(res.statusCode).toBe(200);
      const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      expect(users).toEqual(before.map(user =>
        user.username === 'sandra' ? { ...user, favorites: [] } : user
      ));
      const favorites = await request(app)
        .get('/api/favorites')
        .set('Authorization', 'Bearer ' + getToken());
      expect(favorites.body).toEqual([]);
    });

    it('succeeds when favorites are already empty', async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const res = await request(app)
          .delete('/api/favorites')
          .set('Authorization', 'Bearer ' + getToken());
        expect(res.statusCode).toBe(200);
      }
      const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      expect(users.find(user => user.username === 'sandra').favorites).toEqual([]);
    });

    it.each([
      [undefined, 401],
      ['Bearer ' + 'invalid-token', 403],
      ['Bearer ' + getToken('nouser'), 404],
    ])('rejects unauthorized or unknown users without changing data (%s)', async (authorization, status) => {
      const before = fs.readFileSync(usersFile, 'utf-8');
      const req = request(app).delete('/api/favorites');
      if (authorization) req.set('Authorization', authorization);
      const res = await req;
      expect(res.statusCode).toBe(status);
      expect(fs.readFileSync(usersFile, 'utf-8')).toBe(before);
    });

    it.each(['readFileSync', 'renameSync'])('logs %s errors and preserves all favorites', async (operation) => {
      const before = fs.readFileSync(usersFile, 'utf-8');
      const failure = new Error('Storage unavailable');
      const log = jest.spyOn(console, 'error').mockImplementation(() => {});
      const storage = jest.spyOn(fs, operation).mockImplementationOnce(() => { throw failure; });
      const res = await request(app)
        .delete('/api/favorites')
        .set('Authorization', 'Bearer ' + getToken());

      expect(res.statusCode).toBe(500);
      expect(res.body.message).toBe('Failed to clear favorites. Please try again.');
      expect(log).toHaveBeenCalledWith('Failed to clear favorites:', failure);
      storage.mockRestore();
      expect(fs.readFileSync(usersFile, 'utf-8')).toBe(before);
      expect(fs.readdirSync(path.dirname(usersFile)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    });
  });
});
