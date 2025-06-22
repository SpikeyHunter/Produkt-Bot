require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(bodyParser.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const VERIFY_TOKEN = 'produktbot_verify';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const USER_PASSWORD = process.env.USER_PASSWORD;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

let registrationState = {};

app.get('/', (req, res) => {
  res.status(200).send('Produkt Bot is running!');
});

app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = 'produktbot_verify';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[Webhook Verified]');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      text: { body: text },
    },
    {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    }
  );
}

app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim();

    let { data: user } = await supabase
      .from('bot_users')
      .select('*')
      .eq('bot_userphone', from)
      .maybeSingle();

    // Registration flow
    if (!user || text?.toLowerCase() === 'register') {
      if (!registrationState[from]) {
        registrationState[from] = { step: 1 };
        await sendMessage(from, "Welcome to Produkt BOT! What name do you want to be called?");
        return res.sendStatus(200);
      }
      if (registrationState[from].step === 1) {
        registrationState[from].username = text;
        registrationState[from].step = 2;
        await sendMessage(from, "Please enter your registration password (ask Charles if you don't know it):");
        return res.sendStatus(200);
      }
      if (registrationState[from].step === 2) {
        const pwd = text;
        let role = '';
        if (pwd === ADMIN_PASSWORD) role = 'ADMIN';
        else if (pwd === USER_PASSWORD) role = 'USER';
        else {
          await sendMessage(from, "Incorrect password. Please try again or contact Charles Brousseau.");
          return res.sendStatus(200);
        }
        await supabase.from('bot_users').insert({
          bot_username: registrationState[from].username,
          bot_userphone: from,
          bot_userstatus: 'OPTIN',
          bot_userrole: role,
        });
        delete registrationState[from];
        await sendMessage(from, `Registration successful! You are now registered as ${role}.`);
        return res.sendStatus(200);
      }
    }

    // Unregister command
    if (text?.toLowerCase() === 'unregister') {
      await supabase.from('bot_users').update({ bot_userstatus: 'OPTOUT' }).eq('bot_userphone', from);
      await sendMessage(from, "You have been unregistered. Send 'register' if you want to re-register.");
      return res.sendStatus(200);
    }

    // Already registered
    if (user && user.bot_userstatus === 'OPTIN') {
      await sendMessage(from, `You are already registered as ${user.bot_userrole}.`);
    }
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot server running on port ${PORT}`));
