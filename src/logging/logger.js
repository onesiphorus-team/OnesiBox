const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');

const fileTransport = new winston.transports.DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'onesibox-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '50m',
  maxFiles: '7d',
  zippedArchive: true
});

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
  )
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'onesibox' },
  transports: [fileTransport]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(consoleTransport);
}

module.exports = logger;
