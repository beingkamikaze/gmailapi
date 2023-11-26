const fs = require("fs").promises;
const path = require("path");
const process = require("process");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const cron = require("node-cron");

// If modifying these scopes, delete token.json.
const SCOPES = ["https://mail.google.com/"];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listLabels(auth) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.labels.list({
    userId: "me",
  });
  const labels = res.data.labels;
  if (!labels || labels.length === 0) {
    console.log("No labels found.");
    return;
  }
  console.log("Labels:");
  labels.forEach((label) => {
    console.log(`- ${label.name}`);
  });
}

authorize().then(listLabels).catch(console.error);
//TILL HERE AUTH DONE SUCCESSFULLY

async function handleEmails(auth) {
  const gmail = google.gmail({ version: "v1", auth });
  const labelName = "AutoReplyLabel";

  // Check if the label exists, create if not
  await gmail.users.labels.create({
    userId: "me",
    resource: { name: labelName },
  });

  // Get unread emails
  const response = await gmail.users.messages.list({
    userId: "me",
    labelIds: ["INBOX", "UNREAD"],
  });

  const messages = response.data.messages;

  for (const message of messages) {
    // Check if there are no prior replies
    const thread = await gmail.users.threads.get({
      userId: "me",
      id: message.threadId,
    });

    const messagesInThread = thread.data.messages;
    const isFirstReply = messagesInThread.length === 1;

    if (isFirstReply) {
      // Send a reply
      await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: Buffer.from(
            `To: ${
              thread.data.messages[0].payload.headers.find(
                (header) => header.name === "From"
              ).value
            }\r\n` +
              `Subject: Re: ${
                thread.data.messages[0].payload.headers.find(
                  (header) => header.name === "Subject"
                ).value
              }\r\n` +
              "\r\n" +
              "This is an automated response. Thank you for your email!"
          ).toString("base64"),
        },
      });

      // Add label to the email
      await gmail.users.messages.modify({
        userId: "me",
        id: message.id,
        requestBody: {
          addLabelIds: [labelName],
        },
      });
    }
  }
}

// Load client secrets from a file, then call the authorize method to get user credentials
fs.readFile("credentials.json", (err, content) => {
  if (err) return console.log("Error loading client secret file:", err);
  // Authorize a client with credentials, then call the Gmail API
  authorize(JSON.parse(content), handleEmails);
});

// Set up a timer to repeat the process in random intervals
setInterval(() => {
  fs.readFile("credentials.json", (err, content) => {
    if (err) return console.log("Error loading client secret file:", err);
    // Authorize a client with credentials, then call the Gmail API
    authorize(JSON.parse(content), handleEmails);
  });
}, Math.floor(Math.random() * (120000 - 45000)) + 45000);
