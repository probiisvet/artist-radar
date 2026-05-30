import { Router } from 'express';
import { listTourLeads } from '../db/database.js';

const router = Router();

// GET /api/tours — tour-news leads (web-search hits) for tracked artists.
// Returned under the `tours` key so the frontend contract stays the same.
router.get('/', async (req, res, next) => {
  try {
    const tours = await listTourLeads();
    res.json({ tours });
  } catch (err) {
    next(err);
  }
});

export default router;
