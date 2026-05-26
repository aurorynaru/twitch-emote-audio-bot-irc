export const parseTime = (timeStr) => {
  if (!timeStr) return 5 * 60 * 1000; 
  const match = timeStr.match(/^(\d+)([smh])$/);
  if (!match) return 5 * 60 * 1000;
  const val = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 's') return val * 1000;
  if (unit === 'm') return val * 60 * 1000;
  if (unit === 'h') return val * 60 * 60 * 1000;
  return 5 * 60 * 1000;
};

export const parseFlexibleTime = (timeStr) => {
  if (/^\d+$/.test(timeStr)) return parseInt(timeStr, 10);
  const match = timeStr.match(/^(\d+)([smh])$/i);
  if (!match) return NaN;
  const val = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === 's') return val * 1000;
  if (unit === 'm') return val * 60 * 1000;
  if (unit === 'h') return val * 60 * 60 * 1000;
  return NaN;
};

export const parseAmount = (amountStr) => {
  if (!amountStr) return NaN;
  amountStr = amountStr.toLowerCase();
  
  let multiplier = 1;
  if (amountStr.endsWith('k')) multiplier = 1000;
  else if (amountStr.endsWith('m')) multiplier = 1000000;
  else if (amountStr.endsWith('b')) multiplier = 1000000000;

  if (multiplier !== 1) {
    amountStr = amountStr.slice(0, -1);
  }
  
  const val = parseFloat(amountStr);
  return isNaN(val) ? NaN : Math.floor(val * multiplier);
};

export function adminAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  const user = process.env.ADMIN_USER;

  if (!password) {
    return res.status(401).send('Admin access disabled. Please set ADMIN_PASSWORD in your environment variables.');
  }

  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, pwd] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (login === user && pwd === password) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin Panel"');
  res.status(401).send('Authentication required.');
}
