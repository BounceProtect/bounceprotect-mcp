## BounceProtect MCP Server

Validate email addresses directly from Claude, Cursor, or any MCP-compatible AI assistant.

## Tools available
- validate_email — validate a single email
- validate_emails_bulk — validate up to 100 emails at once
- check_credits — check your credit balance

## Setup

### Get your API key
1. Sign up at https://bounceprotect.com
2. Go to Dashboard → API Keys
3. Create a new key

### Install and configure

#### Claude Desktop
Add to your claude_desktop_config.json:
```json
{
  "mcpServers": {
    "bounceprotect": {
      "command": "node",
      "args": ["/path/to/mcp-server/index.js"],
      "env": {
        "BOUNCEPROTECT_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### Cursor
Add to your Cursor MCP settings:
```json
{
  "bounceprotect": {
    "command": "node",
    "args": ["/path/to/mcp-server/index.js"],
    "env": {
      "BOUNCEPROTECT_API_KEY": "your-api-key-here"
    }
  }
}
```

## Example usage

Once configured, you can ask your AI assistant:
- "Validate the email john@acmecorp.com"
- "Check if these 5 emails are valid: [list]"
- "How many BounceProtect credits do I have left?"
- "Validate all the emails in this list and tell me which ones to remove"

## Pricing
Each email validation costs 1 credit. Start with 100 free credits at bounceprotect.com.
