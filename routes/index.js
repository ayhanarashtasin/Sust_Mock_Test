const express = require('express');
const router = express.Router();
const classifier = require('../services/classifier');

/**
 * GET /health
 * Simple service health check
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'ticket-classifier',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * POST /sort-ticket
 * Accepts a CRM ticket and returns structured classification
 */
router.post('/sort-ticket', async (req, res) => {
  try {
    const body = req.body || {};

    // Validate required fields
    const { ticket_id, channel, locale, message } = body;

    if (!ticket_id || typeof ticket_id !== 'string') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'ticket_id is required and must be a string'
      });
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'message is required and must be a non-empty string'
      });
    }

    // Validate optional fields (warn, but don't fail)
    if (channel && !['app', 'sms', 'call_center', 'merchant_portal'].includes(channel)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'channel must be one of: app, sms, call_center, merchant_portal'
      });
    }

    if (locale && !['bn', 'en', 'mixed'].includes(locale)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'locale must be one of: bn, en, mixed'
      });
    }

    // Call the classifier service
    const result = await classifier.classify({
      ticket_id,
      channel: channel || null,
      locale: locale || null,
      message: message.trim()
    });

    // Echo the ticket_id back (already done by classifier, but safety first)
    result.ticket_id = ticket_id;

    res.status(200).json(result);
  } catch (err) {
    console.error('Error in /sort-ticket:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message || 'Failed to classify ticket'
    });
  }
});

module.exports = router;