const express = require('express');
const { rateLimit } = require('express-rate-limit');

function createFavoritesRouter({ usersFile, booksFile, readJSON, writeJSON, authenticateToken }) {
  const router = express.Router();
  const clearLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many clear requests. Please try again later.' },
  });

  router.get('/', authenticateToken, (req, res) => {
    const users = readJSON(usersFile);
    const user = users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const books = readJSON(booksFile);
    const favorites = books.filter(b => user.favorites.indexOf(b.id) !== -1);
    res.json(favorites);
  });

  router.post('/', authenticateToken, (req, res) => {
    const { bookId } = req.body;
    if (!bookId) return res.status(400).json({ message: 'Book ID required' });
    const users = readJSON(usersFile);
    const user = users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.favorites.indexOf(bookId) == -1) {
      user.favorites.push(bookId);
      writeJSON(usersFile, users);
    }
    res.status(200).json({ message: 'Book added to favorites' });
  });

  router.delete('/', clearLimiter, authenticateToken, (req, res) => {
    try {
      const users = readJSON(usersFile);
      const user = users.find(u => u.username === req.user.username);
      if (!user) return res.status(404).json({ message: 'User not found' });
      user.favorites = [];
      writeJSON(usersFile, users);
      res.json({ message: 'All favorites cleared' });
    } catch (error) {
      console.error('Failed to clear favorites:', error);
      res.status(500).json({ message: 'Failed to clear favorites. Please try again.' });
    }
  });

  return router;
}

module.exports = createFavoritesRouter;
