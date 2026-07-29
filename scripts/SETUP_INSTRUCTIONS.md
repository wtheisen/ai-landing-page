# Tweet Archiver Setup Instructions

This system allows you to share tweets from the Twitter/X app and have them automatically archived to your site.

## Architecture

```
[Share Tweet on iOS]
    → [iOS Shortcut sends URL to webhook]
    → [Google Apps Script adds to Sheet queue]
    → [GitHub Action (every 8 hrs) claims items]
    → [twarc2 fetches tweet data, with public X oEmbed fallback]
    → [Archive to static/md/tweets/]
    → [Commit & rebuild site]
```

## Step 1: Create Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Rename the first sheet tab to **Queue**
3. Add these headers in row 1:
   ```
   id | url | status | created_at | claimed_at | completed_at | meta
   ```

## Step 2: Deploy Google Apps Script Webhook

1. In your Google Sheet, go to **Extensions > Apps Script**
2. Delete any existing code and paste the contents of `google_apps_script_webhook.js`
3. Click **Deploy > New deployment**
4. Click the gear icon and select **Web app**
5. Set:
   - **Execute as**: Me
   - **Who has access**: Anyone
6. Click **Deploy**
7. Click **Authorize access** and allow permissions
8. **Copy the Web app URL** - this is your `SHEETS_WEBHOOK_URL`

## Step 3: Set GitHub Secrets

In your GitHub repository, go to **Settings > Secrets and variables > Actions** and add:

1. **TWITTER_BEARER_TOKEN** *(optional)*: Your Twitter API bearer token
   - Get one from [developer.twitter.com](https://developer.twitter.com)
   - Enables richer media metadata when the app has Post Lookup access
   - If it is absent, capped, or denied, the archiver falls back to X's public
     oEmbed response for the post author, text, URL, and timestamp

2. **SHEETS_WEBHOOK_URL**: The Google Apps Script web app URL from Step 2

## Step 4: Create iOS Shortcut

1. Open the **Shortcuts** app on your iPhone
2. Tap **+** to create a new shortcut
3. Tap the shortcut name at top and rename to **Archive Tweet**
4. Tap **Add Action**
5. Search for and add **Get URLs from Input**
6. Add another action: **Get Contents of URL**
7. Configure it:
   - URL: `[Your SHEETS_WEBHOOK_URL from Step 2]`
   - Method: **POST**
   - Request Body: **JSON**
   - Add key: `url` with value: **Shortcut Input**
8. Add action: **Show Notification**
   - Set message to "Tweet queued for archiving"
9. Tap the **i** icon at bottom
10. Enable **Show in Share Sheet**
11. Set **Share Sheet Types** to **URLs**

### Using the Shortcut

1. In the Twitter/X app, tap **Share** on any tweet
2. Scroll down and tap **Archive Tweet**
3. You'll see a notification confirming the tweet was queued

## Step 5: Verify Setup

1. Share a test tweet using the shortcut
2. Check your Google Sheet - a new row should appear with status "pending"
3. Either wait for the scheduled GitHub Action (every 8 hours) or manually trigger it:
   - Go to your repo's **Actions** tab
   - Click **Archive Tweet** workflow
   - Click **Run workflow**
4. Check `static/md/tweets/` for the archived markdown file

## Troubleshooting

### "Invalid Twitter/X URL" error
- Make sure you're sharing from the actual tweet, not a profile or list

### Tweet not appearing in queue
- Verify the webhook URL is correct
- Check the Apps Script execution logs: In Apps Script, go to **Executions** in the left sidebar

### GitHub Action failing
- Check that both secrets are set correctly
- Look at the action logs for specific error messages
- Verify your Twitter bearer token is valid

### No commits after action runs
- This is normal if there were no items in the queue
- Check the action logs to see if items were processed

## Alternative: Android Setup

For Android, you can use Tasker or IFTTT:

### Tasker
1. Create a profile triggered by Share (Twitter URLs)
2. Create a task that does HTTP POST to your webhook URL with JSON body `{"url": "%CLIP"}`

### IFTTT
1. Create an applet with Twitter share trigger
2. Use Webhooks action to POST to your webhook URL
