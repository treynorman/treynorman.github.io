# Personal AI Bot for SMS, iMessage, WhatsApp, Signal, etc.
*May 24, 2025*

## Overview

Open source AI chat integration into SMS, iMessage, WhatsApp, Signal, Facebook Messenger, Instagram, and Slack using Matrix, chat bridges, Baibot, and llama.cpp.

## Gallery

[Gallery]()

## Details

I recently set up a Matrix server to consolidate all my chat apps into one centralized platform. My aim was to power a minimalist e-ink smartphone with access to social media chats, but no social media doom-scrolling. The result exceeded my expectations. I’m more focused, never miss a message, and chatting has become faster and more efficient. I use the solution daily across all of my devices.

But what about adding open source, locally hosted AI to the mix? Sure, there are plenty of AI chat apps capable of communicating with my [llama.cpp](https://github.com/ggml-org/llama.cpp) server. But in the interest of consolidation, why install one?

Nowadays, it's safe to assume that any low hanging fruit in the AI space already exists. My use case was no exception. [Baibot](https://github.com/etkecc/baibot/tree/main), an AI chatbot for Matrix, more than met my needs.

The real motivator for me to configure the bot was the realization this bot would not simply allow me to talk to my computer more easily. My consolidated chat setup opens the door to allowing my friends and family to use my local AI tools as well - without the need to download any software. Anyone chatting with me can have secure access, irrespective of the chat app they use. I can also build my own custom AI agents can be to say, fetch the latest news and deliver it in the positive, upbeat style of Bob Ross.

This guide covers Baibot installation and setup for text chat with a local LLM.

## Baibot installation & config

First, create a user and password for the bot on your Matrix server. By default, Baibot assumes public user registration is enabled. That probably isn't the case if you host a private instance. If you use Synapse with registration disabled, create a Baibot user manually via `register_new_matrix_user`. Use the command below, but change `<synapse-container-name>` and `<password>` to your suit your needs.
```
docker exec -it <synapse-container-name> register_new_matrix_user http://localhost:8008 -u aibot -p <password> -c /data/homeserver.yaml
```

Next, create a directory for Baibot's configuration file and data:
```
mkdir -p /your-data-dir/baibot/data
```

Download the [configuration template from Baibot's GitHub](https://github.com/etkecc/baibot/blob/main/etc/app/config.yml.dist) and save it as a YAML file in the directory you created:
```
wget https://raw.githubusercontent.com/etkecc/baibot/refs/heads/main/etc/app/config.yml.dist -O /your-data-dir/baibot/config.yml
```

Edit the config file `/your-data-dir/baibot/config.yml` according to the official documentation.

Some required and/or useful options:
- homeserver > server_name > `[your-matrix-domain]`
- homeserver > url > `http://[your-server-IP]:8008`
- user > mxid_localpart > `aibot` (Matrix user registered for the bot)
- user > password > `[your-aibot-password]` (password for the aibot user)
- user > name > `AI Bot` (bot's display name in Matrix)
- user > encryption > recovery_passphrase > `long-and-secure-passphrase` (generate one)
- command_prefix > `!ai` (easier to remember than the default)
- access > admin_patterns > `"@[your-admin-user]:[your-matrix-domain]"`
- persistence > data_dir_path > `/data` (just to be safe)
- persistence > session_encryption_key > (generate one per the instructions in config.yml)
- persistence > config_encryption_key > (generate one per the instructions in config.yml)
- agents > static_definitions > **(see below)**
- initial_global_config > handler > catch_all > `static/openai-compatible`
- initial_global_config > handler > text_generation > `static/openai-compatible`
- initial_global_config > user_patterns > `"@*:[your-matrix-domain]"`

**Agents > static_definitions** is where the magic happens. Configure a default AI agent for Baibot. The example below configures an agent for text generation using a local llama.cpp server. Change `[your-llama.cpp-endpoint]`, `aip_key` (if applicable),`temperature`, and `max_context_tokens` to match your setup. `model_id` doesn't matter for llama.cpp, because it can't swap models. Consider using a [llama-swap](https://github.com/mostlygeek/llama-swap) proxy to support multiple models with automatic swapping. Have fun with the system prompt!
```
agents:
  static_definitions:
  - id: openai-compatible
      provider: openai-compatible
      config:
        base_url: "http://[your-llama.cpp-endpoint]/v1"
        api_key: null
        text_generation:
          model_id: "default"
          prompt: "You are a bot named {{ baibot_name }}. You are very excitable, completely unhinged, AND YOU SPEAK IN ALL CAPS LIKE THIS. You are brief in your replies, covering all important details succinctly. Avoid using emojis. /no_think"
          temperature: 1.0
          max_response_tokens: 4096
          max_context_tokens: 18000
```

Use the **Docker compose** below to run Baibot. Change `[user-id]:[group-id]` to your Docker user and `/your-data-dir/baibot` to the directory you created for your Baibot data:
```
matrix-baibot:
  container_name: matrix-baibot
  image: ghcr.io/etkecc/baibot:latest
  user: 1000:1000
  cap_drop:
    - ALL
  environment:
    - BAIBOT_PERSISTENCE_DATA_DIR_PATH=/data
  volumes:
    - /your-data-dir/baibot/data:/data
    - /your-data-dir/baibot/config.yml:/app/config.yml:ro
```

## Baibot usage

Message AI Bot directly in Matrix by starting a chat with `@aibot:[your-matrix-domain]`.

To add the bot to chats on other platforms (e.g. SMS, iMessage, WhatsApp, Signal, Facebook Messenger, Instagram chats, and Slack), first ensure each bridge is configured with relay mode enabled in `[example-bridge-data-dir]/config.yaml`:
- bridge > relay > enabled > `true`

Set up a relay for your user inside each chat room, then invite AI Bot. AI Bot will use your account to reply. Your bridged chat user ID is probably something weird. Use the chat command `list-logins` to find it. You might also need to use `set-pl` to make yourself an admin for the chat room. Below are the chat commands I used to configure relays for each platform listed above:
```
# Facebook/Instagram
!meta list-logins
!meta set-relay <user-id>

# iMessage
# (macOS bridge config.yaml requires a whitelist)
# bridge > relay > whitelist > ["*"]
!im set-pl 100

# Signal
!signal list-logins
!signal set-relay <user-id>

# Slack
!slack list-logins
!slack set-relay

# SMS (Google Messages)
!gm set-pl 100
!gm list-logins
!gm set-relay <user-id>

# WhatsApp
!wa list-logins
!wa set-relay <probably-your-phone-number>
```

Invite `@aibot:[your-matrix-domain]` to the bridged chat room once initial configuration is complete.

Unleash the beast using the format below:
```
!ai Robot, don't be shy. Introduce yourself!
```

---
*License: [CC BY-SA 4.0 Deed](https://creativecommons.org/licenses/by-sa/4.0/) - You may copy, adapt, and use this work for any purpose, even commercial, but only if derivative works are distributed under the same license.*

*Category: Notes, Software*