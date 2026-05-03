# Game Outreach Workflow

## Overview
Use the game-outreach MCP server to research and manage indie game media outreach.
The server handles data and state. You handle all reasoning, hook generation, and orchestration.

## Standard Outreach Run

1. `get_steam_page` with the game's Steam URL to extract tags, description, game_id
2. `list_templates` to confirm which templates exist
3. `find_channels` using game tags + game name — aim for 20-30 results
4. Filter by relevance: prioritise channels with 5k-200k subscribers for indie games
5. For each shortlisted channel: `get_channel_info` to get recent videos and contact email
6. `check_contact_eligibility` to filter contacts for the chosen template and game_id
7. For each eligible contact:
   a. Read their recent video titles from get_channel_info output
   b. Generate a specific 2-3 sentence hook connecting the game to their content — reference actual video titles by name, not generically
   c. Retrieve template with `get_template`
   d. Substitute {{channel_name}}, {{game_name}}, {{hook}} yourself
   e. Send via the user's email MCP
   f. Immediately call `record_send` on success
8. `get_outreach_summary` to report on the completed run

## Hook Writing Guidelines
- Reference a specific recent video by title — never generic ("I see you cover strategy games")
- Connect one specific game mechanic to what they clearly enjoy covering
- Keep to 2-3 sentences maximum
- Do not mention competitor games
- Do not use superlatives (amazing, incredible, unique)

## Template Placeholder Reference
- {{channel_name}} — display name of the YouTube channel
- {{game_name}} — name of the game from Steam
- {{hook}} — insert your generated personalised paragraph here

## Deduplication
The server tracks every send by contact_email + game_id + template_name.
check_contact_eligibility will exclude anyone already sent a given template for a given game.
A contact can receive different templates, and can receive the same template for different games.
