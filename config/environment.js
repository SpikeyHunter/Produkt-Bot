// config/environment.js - Environment configuration
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_KEY', 
  'WHATSAPP_TOKEN',
  'PHONE_NUMBER_ID',
  'ADMIN_PASSWORD',
  'USER_PASSWORD',
  'TIXR_CPK',
  'TIXR_SECRET_KEY',
  'TIXR_GROUP_ID'
];

const optionalEnvVars = {
  PORT: 3000,
  NODE_ENV: 'production',
  VERIFY_TOKEN: 'produktbot_verify'
};

function validateEnvironment() {
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing);
    process.exit(1);
  }

  // Set defaults for optional vars
  Object.entries(optionalEnvVars).forEach(([key, defaultValue]) => {
    if (!process.env[key]) {
      process.env[key] = defaultValue.toString();
    }
  });

  console.log('✅ Environment configuration validated');
}

function getConfig() {
  return {
    server: {
      port: parseInt(process.env.PORT) || 3000,
      nodeEnv: process.env.NODE_ENV || 'production'
    },
    whatsapp: {
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
      verifyToken: process.env.VERIFY_TOKEN || 'produktbot_verify'
    },
    database: {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_KEY
    },
    tixr: {
      cpk: process.env.TIXR_CPK,
      secretKey: process.env.TIXR_SECRET_KEY,
      groupId: process.env.TIXR_GROUP_ID || '980'
    },
    auth: {
      adminPassword: process.env.ADMIN_PASSWORD,
      userPassword: process.env.USER_PASSWORD
    }
  };
}

module.exports = {
  validateEnvironment,
  getConfig,
  requiredEnvVars
};