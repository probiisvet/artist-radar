import { Router } from 'express';
import { listUpcomingTours } from '../db/database.js';

const router = Router();

// GET /api/tours — upcoming US tours for tracked (non-dismissed) artists
// GET /api/tours?artist_id=... — restrict to one artist
router.get('/', async (req, res, next) => {
  try {
    const artist_id = req.query.artist_id ? String(req.query.artist_id) : undefined;
    const tours = await listUpcomingTours({ artist_id });
    res.json({ tours });
  } catch (err) {
    next(err);
  }
});

export default router;
