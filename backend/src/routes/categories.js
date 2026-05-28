import { Router } from 'express';
import { DISCOVERY_CATEGORIES } from '../config/discoveryCategories.js';
import { getDisabledCategories, setCategoryEnabled } from '../db/database.js';

const router = Router();

// GET /api/categories — list discovery categories with enabled state
router.get('/', async (_req, res, next) => {
  try {
    const disabled = new Set(await getDisabledCategories());
    const categories = DISCOVERY_CATEGORIES.map((c) => ({
      category: c.category,
      description: c.description ?? null,
      enabled: !disabled.has(c.category),
      sources: c.genres.map((g) =>
        g ? `tag:new genre:"${g}"` : 'tag:new (any genre)',
      ),
    }));
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/categories/:category — { enabled: boolean }
router.patch('/:category', async (req, res, next) => {
  try {
    const category = req.params.category;
    const enabled = !!req.body?.enabled;
    await setCategoryEnabled(category, enabled);
    res.json({ category, enabled });
  } catch (err) {
    next(err);
  }
});

export default router;
