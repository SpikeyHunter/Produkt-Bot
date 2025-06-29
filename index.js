// Enhanced index.js with unified command handler and command tracking
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");

// Import utilities
const {
  validateEnvironmentVariables,
  parseCommandWithSuggestions,
  logIncomingMessageWithTyping,
  sendMessage,
  trackCommandUsage,
} = require("./utils");

// Import help handler from existing file
const handleHelp = require("./commands/help");

// Import unified command handlers from botbasic
const {
  handleRegister,
  handleStatus,
  handleUnregister,
  handleListUsers,
  handleTimezone,
  handlePassword
} = require("./botbasic");

// Import remaining specialized handlers
const handleSales = require("./commands/sales");
const handlePromoter = require("./commands/promoter");
const handleRole = require("./commands/role");

// Import new modules
const rateLimiter = require("./middleware/rateLimiter");
const templates = require("./templates/templateLoader");
const database = require("./scripts/database");
const { manageEventSync } = require("./eventManager");

// Environment validation
const requiredEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "WHATSAPP_TOKEN",
  "PHONE_NUMBER_ID",
  "ADMIN_PASSWORD",
  "USER_PASSWORD",
];
validateEnvironmentVariables(requiredEnvVars);

// Constants
const VERIFY_TOKEN = "produktbot_verify";
const PORT = process.env.PORT || 3000;

// State management (consider Redis for production)
let registrationState = {};
let confirmationState = {};
let salesState = {};
let timezoneState = {};
let promoterState = {};
let roleState = {};

// Service clients
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
const app = express();

// Enhanced middleware
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "Produkt-Bot");
  next();
});

// Health check endpoint
app.get("/", (req, res) => {
  res.status(200).json({
    status: "healthy",
    message: "Produkt Bot server is running!",
    timestamp: new Date().toISOString(),
    version: "2.4.0",
    features: [
      "unified_commands",
      "command_tracking",
      "rate_limiting",
      "templates",
      "enhanced_logging",
      "timezone_support",
      "webhook_filtering",
      "promoter_tracking",
      "role_management",
    ],
  });
});

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    console.error("❌ Webhook verification failed");
    res.sendStatus(403);
  }
});

// Enhanced webhook handler with unified commands and command tracking
app.post("/webhook", async (req, res) => {
  try {
    // STEP 1: Validate webhook structure
    const entry = req.body.entry?.[0];
    if (!entry) {
      console.log("🔍 Webhook: No entry found, ignoring");
      return res.sendStatus(200);
    }

    const changes = entry.changes?.[0];
    if (!changes) {
      console.log("🔍 Webhook: No changes found, ignoring");
      return res.sendStatus(200);
    }

    const value = changes.value;
    if (!value) {
      console.log("🔍 Webhook: No value found, ignoring");
      return res.sendStatus(200);
    }

    // STEP 2: Check if this is a message event (not status update)
    if (
      !value.messages ||
      !Array.isArray(value.messages) ||
      value.messages.length === 0
    ) {
      console.log(
        "🔍 Webhook: No messages array or empty, likely status update - ignoring"
      );
      return res.sendStatus(200);
    }

    const message = value.messages[0];

    // STEP 3: Validate message structure and type
    if (!message || !message.from || !message.id) {
      console.log("🔍 Webhook: Invalid message structure, ignoring");
      return res.sendStatus(200);
    }

    // STEP 4: Only process text messages
    if (message.type !== "text") {
      console.log(
        `🔍 Webhook: Non-text message type (${message.type}), ignoring`
      );
      return res.sendStatus(200);
    }

    // STEP 5: Validate text content
    const text = message.text?.body?.trim();
    if (!text || text.length === 0) {
      console.log("🔍 Webhook: Empty text message, ignoring");
      return res.sendStatus(200);
    }

    const from = message.from;
    const messageId = message.id;

    // STEP 6: Ignore messages from the bot itself
    if (from === process.env.PHONE_NUMBER_ID) {
      console.log("🔍 Webhook: Message from bot itself, ignoring");
      return res.sendStatus(200);
    }

    // STEP 7: Log that we're processing a valid message
    console.log(`📩 Processing valid message from ${from}: "${text}"`);

    // Rate limiting check
    const rateCheck = rateLimiter.isAllowed(from);
    if (!rateCheck.allowed) {
      await sendMessage(from, rateCheck.message);
      return res.sendStatus(200);
    }

    // Background event sync
    manageEventSync().catch((err) =>
      console.error("Event Sync Background Process Failed:", err)
    );

    // Get user data
    const userResult = await database.getUser(from);
    const user = userResult.success ? userResult.user : null;

    if (userResult.success === false) {
      console.error("Database error:", userResult.error);
      const generalTemplates = templates.get("general");
      await sendMessage(from, generalTemplates.technicalIssue);
      return res.sendStatus(200);
    }

    // Log incoming message
    logIncomingMessageWithTyping(from, text, user, messageId);

    // Parse command with suggestions
    const commandResult = parseCommandWithSuggestions(text, user);
    const command = commandResult.command;
    const suggestion = commandResult.suggestion;

    // Check for ongoing flows FIRST - before any command processing
    const isRegistering = registrationState[from];
    const isConfirming = confirmationState[from];
    const isHandlingSales = salesState[from];
    const isChangingTimezone = timezoneState[from];
    const isHandlingPromoter = promoterState[from];
    const isHandlingRole = roleState[from];

    // Handle ongoing flows FIRST
    if (isRegistering) {
      registrationState = await handleRegister(
        from,
        text,
        registrationState,
        supabase
      );
      return res.sendStatus(200);
    }

    if (isConfirming?.action === "unregister") {
      confirmationState = await handleUnregister(
        from,
        text,
        confirmationState,
        supabase,
        user
      );
      return res.sendStatus(200);
    }

    if (isHandlingSales) {
      const result = await handleSales(from, text, salesState, supabase, user);
      
      // Check if user switched to another command
      if (result._commandSwitch) {
        salesState = { ...result };
        delete salesState._commandSwitch;
        
        // Process the new command immediately
        const switchData = result._commandSwitch;
        console.log(`🔄 Processing switched command from sales: ${switchData.command}`);
        
        // Track the switched command
        if (user) {
          await trackCommandUsage(switchData.from, switchData.command, supabase);
        }
        
        const textParts = switchData.text.toLowerCase().trim().split(" ");
        const parameter = textParts.slice(1).join(" ");
        
        switch (switchData.command) {
          case "help":
            await handleHelp(switchData.from, user);
            break;
          case "status":
            await handleStatus(switchData.from, user, parameter, supabase);
            break;
          case "timezone":
            console.log(`🌍 Starting timezone flow for user ${switchData.from}`);
            timezoneState = await handleTimezone(
              switchData.from,
              switchData.text,
              timezoneState,
              supabase,
              user
            );
            break;
          case "role":
            console.log(`🎭 Starting role management flow for user ${switchData.from}`);
            roleState = await handleRole(switchData.from, switchData.text, roleState, supabase, user, parameter);
            break;
          case "promoter":
            if (user.bot_userrole === "ADMIN") {
              console.log(`🎫 Starting promoter flow for admin user ${switchData.from}`);
              promoterState = await handlePromoter(
                switchData.from,
                switchData.text,
                promoterState,
                supabase,
                user
              );
            } else {
              const generalTemplates = templates.get("general");
              await sendMessage(switchData.from, generalTemplates.accessDenied);
            }
            break;
          case "password":
            await handlePassword(switchData.from, user);
            break;
          case "list":
            if (textParts[1] === "users" && user?.bot_userrole === "ADMIN") {
              await handleListUsers(switchData.from, supabase);
            }
            break;
          case "unregister":
            const targetUsername = user?.bot_userrole === "ADMIN" && parameter ? parameter : "";
            confirmationState = await handleUnregister(
              switchData.from,
              switchData.text,
              confirmationState,
              supabase,
              user,
              targetUsername
            );
            break;
          default:
            // Unknown command after switch
            const generalTemplates = templates.get("general", {
              username: user.bot_username,
              text: switchData.text,
            });
            await sendMessage(switchData.from, generalTemplates.userGreeting);
        }
      } else {
        salesState = result;
      }
      return res.sendStatus(200);
    }

    if (isChangingTimezone) {
      timezoneState = await handleTimezone(
        from,
        text,
        timezoneState,
        supabase,
        user
      );
      return res.sendStatus(200);
    }

    if (isHandlingPromoter) {
      promoterState = await handlePromoter(
        from,
        text,
        promoterState,
        supabase,
        user
      );
      return res.sendStatus(200);
    }

    if (isHandlingRole) {
      roleState = await handleRole(from, text, roleState, supabase, user);
      return res.sendStatus(200);
    }

    // Handle unregistered users (except for register and help commands)
    if (!user && command !== "register" && command !== "help") {
      const generalTemplates = templates.get("general");
      await sendMessage(from, generalTemplates.welcomeUnregistered);
      return res.sendStatus(200);
    }

    // Process new commands if NOT in any ongoing flow
    if (command) {
      const textParts = text.toLowerCase().trim().split(" ");
      const parameter = textParts.slice(1).join(" ");

      // Track command usage (only for registered users and valid commands)
      if (user && ['help', 'status', 'unregister', 'list', 'sales', 'timezone', 'promoter', 'role', 'password'].includes(command)) {
        await trackCommandUsage(from, command, supabase);
      }

      switch (command) {
        case "help":
          await handleHelp(from, user);
          break;

        case "register":
          // Don't track register command since user doesn't exist yet
          registrationState = await handleRegister(
            from,
            text,
            registrationState,
            supabase
          );
          break;

        case "status":
          // Only allow if user is registered
          if (!user) {
            const generalTemplates = templates.get("general");
            await sendMessage(from, generalTemplates.welcomeUnregistered);
          } else {
            await handleStatus(from, user, parameter, supabase);
          }
          break;

        case "unregister":
          // Only allow if user is registered
          if (!user) {
            const generalTemplates = templates.get("general");
            await sendMessage(from, generalTemplates.welcomeUnregistered);
          } else {
            const targetUsername =
              user?.bot_userrole === "ADMIN" && parameter ? parameter : "";
            confirmationState = await handleUnregister(
              from,
              text,
              confirmationState,
              supabase,
              user,
              targetUsername
            );
          }
          break;

        case "list":
          // Only allow if user is registered and admin
          if (!user) {
            const generalTemplates = templates.get("general");
            await sendMessage(from, generalTemplates.welcomeUnregistered);
          } else if (
            textParts[1] === "users" &&
            user?.bot_userrole === "ADMIN"
          ) {
            await handleListUsers(from, supabase);
          } else {
            const generalTemplates = templates.get("general", {
              command: text,
            });
            await sendMessage(from, generalTemplates.unknownCommand);
          }
          break;

        case "sales":
          // Only allow if user is registered
          if (!user) {
            const generalTemplates = templates.get("general");
            await sendMessage(from, generalTemplates.welcomeUnregistered);
          } else {
            console.log(`🔍 Starting sales flow for user ${from}`);
            const result = await handleSales(
              from,
              text,
              salesState,
              supabase,
              user
            );
            
            // Check if user switched to another command
            if (result._commandSwitch) {
              salesState = { ...result };
              delete salesState._commandSwitch;
              
              // Process the new command
              const switchData = result._commandSwitch;
              console.log(`🔄 Processing switched command: ${switchData.command}`);
              
              // Track the switched command
              await trackCommandUsage(switchData.from, switchData.command, supabase);
              
              // Re-run the switch with the new command
              const textParts = switchData.text.toLowerCase().trim().split(" ");
              const parameter = textParts.slice(1).join(" ");
              
              switch (switchData.command) {
                case "help":
                  await handleHelp(switchData.from, user);
                  break;
                case "status":
                  await handleStatus(switchData.from, user, parameter, supabase);
                  break;
                case "timezone":
                  console.log(`🌍 Starting timezone flow for user ${switchData.from}`);
                  timezoneState = await handleTimezone(
                    switchData.from,
                    switchData.text,
                    timezoneState,
                    supabase,
                    user
                  );
                  break;
                case "role":
                  console.log(`🎭 Starting role management flow for user ${switchData.from}`);
                  roleState = await handleRole(switchData.from, switchData.text, roleState, supabase, user, parameter);
                  break;
                case "promoter":
                  if (user.bot_userrole === "ADMIN") {
                    console.log(`🎫 Starting promoter flow for admin user ${switchData.from}`);
                    promoterState = await handlePromoter(
                      switchData.from,
                      switchData.text,
                      promoterState,
                      supabase,
                      user
                    );
                  } else {
                    const generalTemplates = templates.get("general");
                    await sendMessage(switchData.from, generalTemplates.accessDenied);
                  }
                  break;
                case "password":
                  await handlePassword(switchData.from, user);
                  break;
                case "list":
                  if (textParts[1] === "users" && user?.bot_userrole === "ADMIN") {
                    await handleListUsers(switchData.from, supabase);
                  }
                  break;
                case "unregister":
                  const targetUsername = user?.bot_userrole === "ADMIN" && parameter ? parameter : "";
                  confirmationState = await handleUnregister(
                    switchData.from,
                    switchData.text,
                    confirmationState,
                    supabase,
                    user,
                    targetUsername
                  );
                  break;
                default:
                  // Unknown command after switch
                  const generalTemplates = templates.get("general", {
                    username: user.bot_username,
                    text: switchData.text,
                  });
                  await sendMessage(switchData.from, generalTemplates.userGreeting);
              }
            } else {
              salesState = result;
            }
          }
          break;

        case "timezone":
          // Only allow if user is registered
          if (!user) {
            const generalTemplates = templates.get("general");
            await sendMessage(from, generalTemplates.welcomeUnregistered);
          } else {
            console.log(`🌍 Starting timezone flow for user ${from}`);
            timezoneState = await handleTimezone(
              from,
              text,
              timezoneState,
              supabase,
              user
            );
          }
          break;

        case "promoter":
          // Only allow if user is registered and admin
          if (!user) {
            const generalTemplates = templates.get("general");
            await sendMessage(from, generalTemplates.welcomeUnregistered);
          } else if (user.bot_userrole !== "ADMIN") {
            const generalTemplates = templates.get("general");
            await sendMessage(from, generalTemplates.accessDenied);
          } else {
            console.log(`🎫 Starting promoter flow for admin user ${from}`);
            promoterState = await handlePromoter(
              from,
              text,
              promoterState,
              supabase,
              user
            );
          }
          break;

        case "role":
          // Only allow if user is registered
          if (!user) {
            const generalTemplates = templates.get("general");
            await sendMessage(from, generalTemplates.welcomeUnregistered);
          } else {
            console.log(`🎭 Starting role management flow for user ${from}`);
            const parameter = textParts.slice(1).join(" "); // Get username for admin management
            roleState = await handleRole(from, text, roleState, supabase, user, parameter);
          }
          break;

        case "password":
          // Only allow if user is registered and admin
          if (!user) {
            const generalTemplates = templates.get("general");
            await sendMessage(from, generalTemplates.welcomeUnregistered);
          } else {
            await handlePassword(from, user);
          }
          break;

        default:
          if (user) {
            const generalTemplates = templates.get("general", {
              username: user.bot_username,
              text: text,
            });
            await sendMessage(from, generalTemplates.userGreeting);
          } else {
            const generalTemplates = templates.get("general");
            await sendMessage(from, generalTemplates.guestGreeting);
          }
      }
    } else if (suggestion?.message) {
      await sendMessage(from, suggestion.message);
    } else {
      if (user) {
        const generalTemplates = templates.get("general", {
          username: user.bot_username,
          text: text,
        });
        await sendMessage(from, generalTemplates.userGreeting);
      } else {
        const generalTemplates = templates.get("general");
        await sendMessage(from, generalTemplates.guestGreeting);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook error:", error);

    try {
      const from =
        req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (from) {
        const generalTemplates = templates.get("general");
        await sendMessage(from, generalTemplates.technicalIssue);
      }
    } catch (sendError) {
      console.error("❌ Failed to send error message:", sendError);
    }

    res.sendStatus(500);
  }
});

// Enhanced stats endpoint with role information and command tracking
app.get("/api/stats", async (req, res) => {
  try {
    const [dbStats, rateLimitStats] = await Promise.all([
      database.getAllUsers(),
      Promise.resolve(rateLimiter.getStatus()),
    ]);

    if (!dbStats.success) {
      throw new Error(dbStats.error);
    }

    const users = dbStats.users || [];

    // Count secondary roles
    const roleStats = {};
    users.forEach((user) => {
      if (user.bot_secondary_roles) {
        const roles = user.bot_secondary_roles.split(",");
        roles.forEach((role) => {
          roleStats[role] = (roleStats[role] || 0) + 1;
        });
      }
    });

    // Calculate command usage statistics
    const totalCommands = users.reduce((sum, user) => sum + (user.bot_command_use || 0), 0);
    const avgCommandsPerUser = users.length > 0 ? Math.round(totalCommands / users.length) : 0;
    const mostActiveUser = users.reduce((max, user) => 
      (user.bot_command_use || 0) > (max.bot_command_use || 0) ? user : max, 
      { bot_command_use: 0, bot_username: "None" }
    );

    const summary = {
      users: {
        total: users.length,
        admins: users.filter((u) => u.bot_userrole === "ADMIN").length,
        regular: users.filter((u) => u.bot_userrole === "USER").length,
      },
      commands: {
        total: totalCommands,
        averagePerUser: avgCommandsPerUser,
        mostActiveUser: {
          name: mostActiveUser.bot_username,
          commands: mostActiveUser.bot_command_use || 0
        }
      },
      secondaryRoles: roleStats,
      timezones: {
        montreal: users.filter(
          (u) => u.bot_user_timezone === "America/New_York"
        ).length,
        la: users.filter((u) => u.bot_user_timezone === "America/Los_Angeles")
          .length,
        utc: users.filter((u) => u.bot_user_timezone === "UTC").length,
      },
      rateLimiting: rateLimitStats,
      templates: {
        loaded: templates.list().length,
        available: templates.list(),
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
      },
    };

    res.json(summary);
  } catch (error) {
    console.error("❌ Stats endpoint error:", error);
    res.status(500).json({
      error: "Failed to fetch statistics",
      timestamp: new Date().toISOString(),
    });
  }
});

// Admin endpoint for template reload (useful for development)
app.post("/api/admin/reload-templates", (req, res) => {
  try {
    templates.reload();
    res.json({
      success: true,
      message: "Templates reloaded successfully",
      count: templates.list().length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test database connection on startup
database.testConnection().then((result) => {
  if (result.success) {
    console.log("✅ Database connection verified");
  } else {
    console.error("❌ Database connection failed:", result.error);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Enhanced Produkt Bot server running on port ${PORT}`);
  console.log(`✅ Server started at ${new Date().toISOString()}`);
  console.log(
    `📊 Features: Unified Commands, Command Tracking, Rate Limiting, Templates, Enhanced Logging, Timezone Support, Promoter Tracking, Role Management`
  );
  console.log(`📋 Templates loaded: ${templates.list().length}`);
});

// Keep-alive for Render.com
setInterval(() => {
  console.log(`🔄 Keep-alive ping - ${new Date().toISOString()}`);
}, 13 * 60 * 1000);