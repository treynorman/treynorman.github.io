# Merging All Chat Apps with a Selfhosted Matrix Server & Bridges
*May 4, 2025*

## Overview

**Includes:  [Matrix](https://matrix.org/) [Synapse](https://github.com/element-hq/synapse) (server), [PostgreSQL](https://www.postgresql.org/) (database), [Matrix chat briges](https://matrix.org/ecosystem/bridges/), [Element](https://app.element.io/) (web / mobile client), [ntfy](https://ntfy.sh/) (notification service)**  
**Unifies:  Facebook Messenger, Instagram DMs, iMessage, Signal, Slack, SMS, WhatsApp**

This is a guide for setting up a private, encrypted chat service to unify all chat apps into a single portal.

The solution is free and open source. It includes customizable bridges to external chat services and a postgres database capable handling heavy workloads. It's comprised of more than 10 Docker containers. The end result can be configured to federate across the global Matrix network and handle dozens of users.

That is to say, it's undoubtedly overkill to set up something this complex for a single user. But it's the only private solution to the problem.

## Background

My goal with this project was to merge my chats from the Zuckerverse (Facebook, Instagram, WhatsApp), iMessage (without an iPhone), Signal, Slack, and SMS into one place without giving keys to all of my private conversations to some randos at public company. In doing so, I've built a private version [Beeper](https://www.beeper.com/) that's easy to update and maintain. And you can, too!

Matrix isn't easy to install with Docker compose. The ecosystem claims to support it, but Docker is not the standard way to install Matrix. Getting up and running with a clean, containerized solution requires wading through sparse documentation, reading a blog post or two, then piecing everything together. Bridge configuration to connect to other chat apps is even more time consuming. So, this guide is as much for me to use as it is for you—after I've forgotten everything, something breaks, and I don't know why.

## Subdomain setup

Assuming you already own a domain like **example.com**, pick a couple of subdomains for your server and web client. For example, **server.example.com** and **app.example.com**.

Configure those on your DNS provider, so they point to your Matrix server. I like [Clouflare](https://www.cloudflare.com/), because it's free and comes with DDoS protection.

Cloudflare DNS config documentation:  
https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-subdomain

## Docker compose (Synapse, Element, PostgreSQL)

Below is an example [Docker compose](https://docs.docker.com/compose/) file based on my config.

```
services:
  matrix-synapse:
    image: matrixdotorg/synapse:latest
    container_name: matrix-synapse
    restart: unless-stopped
    environment:
      TZ: America/Chicago
    user: [user-id]:[group-id]
    ports:
      - 8008:8008
      # - 8448:8448  # Federation port
    volumes:
      - /your-data-dir/synapse:/data
      - /your-media-dir:/media  # Optional 
    depends_on:
      - matrix-db
  matrix-db:
    image: postgres
    container_name: matrix-db
    environment:
      POSTGRES_USER: "synapse"
      POSTGRES_PASSWORD: "your-super-sercret-password"
      POSTGRES_DB: "synapse"
      POSTGRES_INITDB_ARGS: "--encoding=UTF-8 --lc-collate=C --lc-ctype=C"
    ports:
      - 8009:5432
    volumes:
      - /your-data-dir/db:/var/lib/postgresql/data
  matrix-element:
    image: vectorim/element-web:latest
    container_name: matrix-element
    restart: unless-stopped
    ports:
      - 8010:80
    volumes:
      - /your-data-dir/element/config.json:/app/config.json
```

`[user-id]:[group-id]` should match your Docker user for Synapse.

Under `volumes`, define directories for the all of the data and config files. Make sure you've created those directories, e.g.
```
mkdir -p /your-data-dir/synapse
mkdir -p /your-data-dir/element
mkdir -p /your-data-dir/db
```

You might want to store large media files on a big hard drive and have the rest of the data served from a faster, more expensive hard drive. I do. To achieve this, change `/your-media-dir` to the location of your choice. To skip it, remove this line.

`POSTGRES_PASSWORD: "your-super-sercret-password"` should be an actual super secret password for the postgres database.

The ports I've used are:
- 8008 - [Synapse, the Matrix server](https://github.com/element-hq/synapse) (default)
- 8009 - Synapse postgres database
- 8010 - [Element, the Matrix web client](https://github.com/element-hq/element-web)
- 8448 - Synapse federation port*

Note: We won't be setting up federation in this tutorial.

## Configure the Synapse server

Run the command below once to generate the base config files. Change `[user-id]:[group-id]`, `/your-data-dir/synapse`, and `server.example.com` to match your setup:
```
docker run -it --user [user-id]:[group-id] c --rm \
    -v /your-data-dir/synapse:/data \
    -e SYNAPSE_SERVER_NAME=server.example.com \
    -e SYNAPSE_REPORT_STATS=yes \
    matrixdotorg/synapse:latest generate
```

Navigate to `/your-data-dir/synapse`. Edit `homeserver.yaml` and replace the SQLite database section with the block below. Be sure to include `your-super-sercret-password` for the postgres database.
```
database:
  name: psycopg2
  args:
    user: synapse
    password: your-super-sercret-password
    dbname: synapse
    host: matrix-db
    cp_min: 5
    cp_max: 10
    # seconds of inactivity after which TCP should send a keepalive message to the server
    keepalives_idle: 10
    # the number of seconds after which a TCP keepalive message that is not
    # acknowledged by the server should be retransmitted
    keepalives_interval: 10
    # the number of TCP keepalives that can be lost before the client's connection
    # to the server is considered dead
    keepalives_count: 3
```

Why not use SQLite and skip the postgres container?

SQLite won't perform well with multiple users, and Matrix won't allow you to federate without postgres. The rest of this guide also assumes that a postgres instance is available to create databases for each chat bridge.

Finally, if you chose to store media files on a separate drive, set `media_store_path` to `/media` (the path mapped in Docker compose):
```
media_store_path: /media
```

## Configure the Element web client

For element to start, it needs to know where to find your Matrix server.

Navigate to `/your-data-dir/element` and download the default Element config file from here: https://app.element.io/config.json
```
wget https://app.element.io/config.json
```

Edit `config.json` and tell it to connect to your Matrix server by default:
```
{
    "default_server_name": "matrix.example.com",
    "default_server_config": {
        "m.homeserver": {
            "base_url": "https://matrix.example.com"
        },
        "m.identity_server": {
            "base_url": "https://vector.im"
        }
    }
    ...
```

Disable the account creation button (unless you like that sort of thing) by adding this line to `setting_defaults`:
```
    ...
    "setting_defaults": {
        "UIFeature.registration": false
    }
    ...
```

Full config documentation: https://web-docs.element.dev/Element%20Web/config.html

## Create an admin user for Synapse

First, boot up all of the contianers:
```
docker compose up -d
```

After Synapse is running, create an admin user via `register_new_matrix_user`. Don't just copy/paste the command below. Change `<username>` and `<password>` to your suit your needs.
```
docker exec -it matrix-synapse register_new_matrix_user http://localhost:8008 -u <username> -p <password> -a -c /data/homeserver.yaml
```

Navigate to `/your-data-dir/synapse`. Edit `homeserver.yaml` and add the lines below to disable registration until you're ready to add more users. Also, encrypt chats by default (why isn't this the default setting?) and disallow the creation of public rooms to defend against port scanning spammers if you federate.
```
enable_registration: false
registration_requires_token: true
allow_public_rooms_without_auth: false
allow_public_rooms_over_federation: false
encryption_enabled_by_default_for_room_type: all
```

If you'd like to enable new user registration in the future on an invite-only basis, [token registration](https://element-hq.github.io/synapse/latest/usage/administration/admin_api/registration_tokens.html) is possible and included in this setup. The app [synapse-admin](https://github.com/Awesome-Technologies/synapse-admin) can help with that.

Restart Synapse for the config changes to take effect:
```
docker restart matrix-synapse
```

## Open it up to the big, scary internet

[Configure your nginx reverse proxy to open Synapse and Element up to the web.](https://element-hq.github.io/synapse/latest/reverse_proxy.html)

There are a number of ways to do this and tools to assist. You might choose to use vanilla nginx + Certbot, Caddy, or SWAG. Detailing any one solution is beyond the scope of this write-up.

Make sure port 443 is open on your firewall and forwarded to your server from your router. Maybe open port 80 as well if you're not strict about SLL encryption. Port 8448 is used for federation, which we're ignoring for now.

Once complete, your subdomains (e.g. **server.example.com** and **app.example.com**) should resolve to Synapse and Element respectively.

## Notifications sold separately (ntfy)

Notifications will not be sent to your smartphone from your new chat service without setting up another service inside another Docker container. Yep.

To configure Matrix Synapse to send push notifications, navigate to `/your-data-dir/synapse` and edit `homeserver.yaml`. Add the lines shown below.
```
push:
  gateway:
    url: "https://ntfy.example.com/_matrix/push/v1/notify"
  enabled: true
  include_content: true
  group_unread_count_by_room: false

ip_range_whitelist:
 - '127.0.0.1'
 - '192.168.0.0/16'
 - '10.0.0.0/8'
```

Next, create a directory for ntfy to store its data. Ntfy is useful for other things, too, so it doesn't need to be grouped together with the Matrix data unless you want it to be.
```
mkdir /your-data-dr/ntfy
```

Docker compose for the [ntfy](https://ntfy.sh/) service:
```
services:
  ntfy:
    image: binwiederhier/ntfy
    restart: unless-stopped
    container_name: ntfy
    environment:
      NTFY_BASE_URL: https://ntfy.example.com
      NTFY_CACHE_FILE: /var/lib/ntfy/cache.db
      NTFY_CACHE_DURATION: 36h
      NTFY_ATTACHMENT_CACHE_DIR: /var/lib/ntfy/attachments
      NTFY_AUTH_FILE: /var/lib/ntfy/auth.db
      NTFY_AUTH_DEFAULT_ACCESS: deny-all
      NTFY_WEB_ROOT: disable
      NTFY_BEHIND_PROXY: true
      NTFY_ENABLE_LOGIN: true
      NTFY_UPSTREAM_BASE_URL: https://ntfy.sh
    volumes:
      - /your-data-dr/ntfy:/var/lib/ntfy
    ports:
      - 8093:80
    command: serve
```

Replace `http://ntfy.example.com` with a subdomain of your choice. Replace `/your-data-dr/ntfy` with the location you chose for your ntfy data. The rest of the settings/environment variables can remain unchanged, but feel free to customize. [Ntfy configuration documentation](https://docs.ntfy.sh/config/).

**Users must be added manually on a per-user basis and install the ntfy app to receive push notifications.**

To add a user, enter the ntfy Docker container via the terminal. Use a strong password, because ntfy will be open to the outside internet.
```
docker exec -it ntfy sh
ntfy user add <username>
```

Allow the user to only subscribe  to UnifiedPush topics (read permissions) and ensure that Matrix apps can push notifications via UnifiedPush (write permissions):
```
ntfy access <username> 'up*' read-only
ntfy access '*' 'up*' write-only
```

For a user to receive notifications, they must do the following:
- Download the **ntfy app** for [Android](https://f-droid.org/en/packages/io.heckel.ntfy/) or [iPhone](https://apps.apple.com/us/app/ntfy/id1625396347)
- Go to **Settings > General > Default server** and point it to your server, e.g. https://ntfy.example.com
- Go to **Settings > General > Manage users > Add new user** and enter your server as the Service URL, their ntfy username, and their ntfy password
- (Android only) Disable Android's braindead battery optimizations, so it doesn't kill the app when it's running in the background

Now, a user running a Matrix app like **[Element X](https://element.io/app)** can receive notifications via ntfy. Nifty!

## Matrix general bridge config (double puppeting)

Once you're bored of chatting with yourself, you'll want to connect some chat services. But don't do it until you've configured double puppeting.

Double puppeting ensures seamless bridging to external chat apps. With double puppeting, chats from external apps will look like they came from your contacts. A bunch of other bridge functions work better, too. 

Don't skip this. We'll set up *automatic* double puppeting, so we and our users can be lazy moving forward.

Navigate to `/your-data-dir/synapse` and create a file called `doublepuppet.yaml`. Add the lines shown below.
```
id: doublepuppet
url:      # intentionally left blank
as_token: random_string
hs_token: random_string
sender_localpart: random_string
rate_limited: false
namespaces:
  users:
  # Replace server\.example\.com with your server domain with \ before any .
  - regex: '@.*:server\.example\.com'
    exclusive: false
```

Be sure to change `server\.example\.com` to your Matrix server domain, and don't forget the escape characters, e.g. `\`, or you'll confuse regex.

You can use the command below to generate `random_strings` as needed:
```
cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 64 | head -n 1
```

Finally, edit `homeserver.yaml` and add the lines below to register `doublepuppet.yaml` as an app service on your Matrix Synapse server:
```
app_service_config_files:
- /data/doublepuppet.yaml
```

Restart Synapse for the config changes to take effect:
```
docker restart matrix-synapse
```

Full documentation: https://docs.mau.fi/bridges/general/double-puppeting.html

## Matrix / Facebook Messenger & Instagram DM bridge config

On your Matrix server, create a data directory for the bridge service inside `/your-data-dir`:
```
mkdir /your-data-dir/mautrix-meta
```

Create a database for the bridge on your `matrix-db` instance:
```
docker exec -e PGPASSWORD=<your-postgres-password> -it matrix-db \
  psql -U synapse -d postgres \
  -c "CREATE DATABASE \"mautrix-meta\";"
```

Docker compose for the [mautrix-meta](https://github.com/mautrix/meta) bridge:
```
services:
  mautrix-meta:
    image: dock.mau.dev/mautrix/meta:latest
    container_name: mautrix-meta
    restart: unless-stopped
    volumes:
    - /your-data-dir/mautrix-meta:/data
```

Start and stop the bridge to create a config file:
```
docker compose up -d
docker stop mautrix-meta
```

Edit the config file `/your-data-dir/mautrix-meta/config.yaml` according to the official documentation. There's a lot to configure.

Some required and/or useful options:
- network > displayname_template > `'{{or .DisplayName .Username "Unknown user"}} (FB/IG)'` (append FB/IG after name)
- network > ig_e2ee > `true` (you want encryption if you've come this far)
- network > cache_connection_state > `true` (better performance)
- network > disable_xma_always > `true` (don't fetch reels, stories, etc)
- bridge > bridge_matrix_leave > `true` (sync leaving groups)
- bridge > permissions > @admin to your admin username, example.com to your matrix domain
- database > uri > `postgres://synapse:[your-super-sercret-password]@[your-server-IP]:8009/mautrix-meta?sslmode=disable`
- homeserver > address > `http://[your-server-IP]:8008`
- homeserver > domain > `[your-matrix-domain]`
- appservice > address > `http://mautrix-meta:29319`
- appservice > public_address > `[your-matrix-domain]`
- appservice > hostname > `0.0.0.0`
- appservice > bot > username, displayname, avatar > have some fun
- backfill > enabled > `true` (fetch old / missed messages)
- double_puppet > secrets > `[your-matrix-domain]: as_token:[your-token]` (as_token from `/your-data-dir/synapse/doublepuppet.yaml`)
- encryption > allow > `true` (why isn't this the default?)
- encryption > default > `true` (why isn't this the default?)

When finished, restart the container to generate a custom `registration.yaml` for your config:
```
docker restart mautrix-meta
```

Navigate to `/your-data-dir` and copy the `registration.yaml` file to the Synapse data directory with a unique name. Change ownership to match your Docker user for Synapse. Do this as root.
```
cp ./mautrix-meta/registration.yaml ./synapse/mautrix-meta-registration.yaml
chown [user-id]:[group-id] ./synapse/mautrix-meta-registration.yaml
```

Navigate to `/your-data-dir/synapse` and edit `homeserver.yaml`. Add an app service config line for `/data/mautrix-meta-registration.yaml`. This will register the bridge as an appservice on your Matrix Synapse server.
```
app_service_config_files:
...
- /data/mautrix-meta-registration.yaml
...
```

Restart Synapse for the config changes to take effect. Then restart the bridge.
```
docker restart matrix-synapse
docker restart mautrix-meta
```

To test the bridge, start a chat with the bot, e.g. `@metabot:server.example.com`, and say `help`. Be sure to use your actual Matrix server domain.

Chat account login info: https://docs.mau.fi/bridges/go/meta/authentication.html  
Full bridge documentation: https://docs.mau.fi/bridges/general/docker-setup.html?bridge=meta

## Matrix / iMessage bridge config

Apple doesn't like to play nice with others, so this bridge is more of a pain to set up and requires a dedicated macOS computer to intercept iMessages.

Extra hardware required:
- Computer running macOS
-- (stretch goal: [hackintosh](https://github.com/segersniels/hackintosh) running on a [LattePanda Mu](https://www.lattepanda.com/lattepanda-mu))

**On your macOS computer**, [download the latest Mautrix iMessage executable from the official repository](https://mau.dev/mautrix/imessage/-/pipelines?scope=branches&page=1). If you're not sure which version matches the chipset of your macOS computer, use the universal one.

Extract the ZIP archive, rename `example-config.yaml` to `config.yaml`, and edit it according to the documentation in the comments. There's a lot to configure.

Some required and/or useful options:
- homeserver > address > `http://[your-server-IP]:8008`
- homeserver> websocket_proxy > `wss://[your-server-IP]:29331`
- homeserver > domain > `[your-matrix-domain]`
- appservice > bot > username, displayname, avatar > have some fun
- imessage > contacts_mode > `mac` (the default may not work, this will)
- bridge > user > change @you to your username, example.com to your matrix domain
- bridge > personal_filtering_spaces > `true` (create an iMessages space in Matrix, don't jsut blob iMessages together with messages from other sources)
- bridge > max_handle_seconds > `300` (don't send Matrix messages older than 5 minutes to the iMessage recipient, e.g. if the bridge has issues)
- bridge > media_viewer (do nothing, the default settings support high quality media files within iMessage's size limits)
- bridge > reroute_mms_group_replies > `true` (make group messages work properly when MMS users are included in iMessage groups)
- bridge > private_chat_portal_meta > `always` (use room names and avatars from iMessage in encrypted chats, the only chat type we'll use)
- encryption > allow > `true` (why isn't this the default?)
- encryption > default > `true` (why isn't this the default?)

Run `mautrix-imessage` in the terminal on your macOS computer with the flag set to make it generate a registration file. Apple will stop you at first and complain about both the application and required library coming from unknown developers. Tell Apple to stop complaining in your security settings.
```
./mautrix-imessage -g
```

Edit the generated `registration.yaml` file and set the `url` field to point to the Mautrix websockets proxy that doesn't exist yet. You'll set that up soon.
```
id: imessage
url: http://mautrix-wsproxy:29331
...
```

Rename `registration.yaml` to `mautrix-imessage-registration.yaml` and plop it in the Synapse data directory on your Matrix server, i.e. `/your-data-dir/synapse`. Only you know where to do the plopping.

**On your Matrix server**, navigate to `/your-data-dir/synapse` and edit `homeserver.yaml`. Add an app service config line for `/data/mautrix-signal-registration.yaml`. This will register the bridge as an appservice on your Matrix Synapse server.
```
app_service_config_files:
...
- /data/mautrix-signal-registration.yaml
...
```

Get the `as_token` and `hs_token` values from `mautrix-imessage-registration.yaml`. You'll use these to configure the Mautrix websockets proxy server in your Docker compose file.

Docker compose for the [mautrix-wsproxy](https://github.com/mautrix/wsproxy):
```
services:
  mautrix-wsproxy:
    container_name: mautrix-wsproxy
    image: dock.mau.dev/mautrix/wsproxy
    restart: unless-stopped
    ports:
      - 29331
    environment:
      APPSERVICE_ID: imessage
      AS_TOKEN: as_token_from_mautrix_imessage_registration
      HS_TOKEN: hs_token_from_mautrix_imessage_registration
      # These URLs will work as-is with docker networking
      SYNC_PROXY_URL: http://mautrix-syncproxy:29332
      SYNC_PROXY_WSPROXY_URL: http://mautrix-wsproxy:29331
      SYNC_PROXY_SHARED_SECRET: random_string_of_your_choice
  mautrix-syncproxy:
    container_name: mautrix-syncproxy
    image: dock.mau.dev/mautrix/syncproxy
    restart: unless-stopped
    environment:
      #LISTEN_ADDRESS: ":29332"
      DATABASE_URL: postgres://synapse:[your-postgres-password]@http://[your-server-IP]:8009/mautrix_syncproxy
      HOMESERVER_URL: http://192.168.1.80:8008
      SHARED_SECRET: random_string_of_your_choice
```

You might notice that `DATABASE_URL` points to a database that doesn't exist yet. Create that database on your `matrix-db` instance:
```
docker exec -e PGPASSWORD=<your-postgres-password> -it matrix-db \
  psql -U synapse -d postgres \
  -c "CREATE DATABASE \"mautrix-syncproxy\";"
```

Restart Synapse for the config changes to take effect. Then start the proxy servers.
```
docker restart matrix-synapse
docker compose up -d
```

**On your macOS computer**, go to System Preferences -> Security & Privacy -> Privacy -> Full Disk Access and grant access to Terminal. Make sure you're signed into iMessage, and the Messages app running. Then run `mautrix-imessage` in the terminal:
```
./mautrix-imessage
```

iMessage will ask you to grant access to the terminal app and your contacts. Do it!

To test the bridge, start a chat with the bot, e.g. `@imessagebot:server.example.com`, and say `help`. Be sure to use your actual Matrix server domain.

To log in, first run the command below in a terminal.  Replace `matrix_username`, `matrix_password`, and `server.example.com` with your info.
```
curl -XPOST -d '{"type":"m.login.password","identifier":{"type": "m.id.user", "user": "matrix_username"},"password":"matrix_password","initial_device_display_name":"iMessage"}' https://server.example.com/_matrix/client/v3/login
```

You'll receive a response with an `access_token` included. Copy the contents of that token between the parenthesis.

Open a chat in Matrix with the iMessage bot, e.g. `@imessagebot:server.example.com`, and say:
```
login-matrix <access_token>
```

The bot will reply with something cryptic like, "Successfully switched puppet," and you're good to go!

Note: If you're not part of the Apple ecosystem, you might want to import your contacts into the Apple Contacts app and sync them with iMessage. That way, the iMessage bridge will be able to grab your contact names and display them in Matrix.

Full bridge documentation: https://docs.mau.fi/bridges/go/imessage/mac/setup.html

## Matrix / Signal bridge config

On your Matrix server, create a data directory for the bridge service inside `/your-data-dir`:
```
mkdir /your-data-dir/mautrix-signal
```

Create a database for the bridge on your `matrix-db` instance:
```
docker exec -e PGPASSWORD=<your-postgres-password> -it matrix-db \
  psql -U synapse -d postgres \
  -c "CREATE DATABASE \"mautrix-signal\";"
```

Docker compose for the [mautrix-signal](https://github.com/mautrix/signal) bridge:
```
services:
  mautrix-signal:
    container_name: mautrix-signal
    image: dock.mau.dev/mautrix/signal:latest
    restart: unless-stopped
    volumes:
    - /your-data-dir/mautrix-signal:/data
```

Start and stop the bridge to create a config file:
```
docker compose up -d
docker stop mautrix-signal
```

Edit the config file `/your-data-dir/mautrix-signal/config.yaml` according to the official documentation. There's a lot to configure.

Some required and/or useful options:
- network > displayname_template > `'{{or .ContactName .ProfileName .PhoneNumber "Unknown user"}} (Signal)'` (full names from phone contacts with fallbacks to the rest, append Signal)
- bridge > bridge_matrix_leave > `true` (sync leaving groups)
- bridge > permissions > @admin to your admin username, example.com to your matrix domain
- database > uri > `postgres://synapse:[your-super-sercret-password]@[your-server-IP]:8009/mautrix-whatsapp?sslmode=disable`
- homeserver > address > `http://[your-server-IP]:8008`
- homeserver > domain > `[your-matrix-domain]`
- appservice > address > `http://mautrix-signal:29328`
- appservice > public_address > `[your-matrix-domain]`
- appservice > hostname > `0.0.0.0`
- appservice > bot > username, displayname, avatar > have some fun
- backfill > enabled > `true` (fetch old / missed messages)
- double_puppet > secrets > `[your-matrix-domain]: as_token:[your-token]` (as_token from `/your-data-dir/synapse/doublepuppet.yaml`)
- encryption > allow > `true` (why isn't this the default?)
- encryption > default > `true` (why isn't this the default?)

When finished, restart the container to generate a custom `registration.yaml` for your config:
```
docker restart mautrix-signal
```

Navigate to `/your-data-dir` and copy the `registration.yaml` file to the Synapse data directory with a unique name. Change ownership to match your Docker user for Synapse. Do this as root.
```
cp ./mautrix-signal/registration.yaml ./synapse/mautrix-signal-registration.yaml
chown [user-id]:[group-id] ./synapse/mautrix-signal-registration.yaml
```

Navigate to `/your-data-dir/synapse` and edit `homeserver.yaml`. Add an app service config line for `/data/mautrix-signal-registration.yaml`. This will register the bridge as an appservice on your Matrix Synapse server.
```
app_service_config_files:
...
- /data/mautrix-signal-registration.yaml
...
```

Restart Synapse for the config changes to take effect. Then restart the bridge.
```
docker restart matrix-synapse
docker restart mautrix-signal
```

To test the bridge, start a chat with the bot, e.g. `@signalbot:server.example.com`, and say `help`. Be sure to use your actual Matrix server domain.

Chat account login info: https://docs.mau.fi/bridges/go/signal/authentication.html  
Full bridge documentation: https://docs.mau.fi/bridges/general/docker-setup.html?bridge=signal

## Matrix / Slack bridge config

On your Matrix server, create a data directory for the bridge service inside `/your-data-dir`:
```
mkdir /your-data-dir/mautrix-slack
```

Create a database for the bridge on your `matrix-db` instance:
```
docker exec -e PGPASSWORD=<your-postgres-password> -it matrix-db \
  psql -U synapse -d postgres \
  -c "CREATE DATABASE \"mautrix-slack\";"
```

Docker compose for the [mautrix-slack](https://github.com/mautrix/slack) bridge:
```
services:
  mautrix-slack:
    container_name: mautrix-slack
    image: dock.mau.dev/mautrix/slack:latest
    restart: unless-stopped
    volumes:
    - /your-data-dir/mautrix-slack:/data
```

Start and stop the bridge to create a config file:
```
docker compose up -d
docker stop mautrix-slack
```

Edit the config file `/your-data-dir/mautrix-whatsapp/config.yaml` according to the official documentation. There's a lot to configure.

Some required and/or useful options:
- network > displayname_template > `'{{or .Profile.DisplayName .Profile.RealName .Name}}{{if .IsBot}} (Bot){{end}} (Slack)'` (append Slack)
- network > participant_sync_count > `10` (users from Slack channels to show in Matrix on initial sync)
- network > mute_channels_by_default > `true` (for sanity, notifications disabled by default)
- bridge > bridge_matrix_leave > `true` (sync leaving channels)
- bridge > permissions > @admin to your admin username, example.com to your matrix domain
- database > uri > `postgres://synapse:[your-super-sercret-password]@[your-server-IP]:8009/mautrix-whatsapp?sslmode=disable`
- homeserver > address > `http://[your-server-IP]:8008`
- homeserver > domain > `[your-matrix-domain]`
- appservice > address > `http://mautrix-slack:29335`
- appservice > public_address > `[your-matrix-domain]`
- appservice > hostname > `0.0.0.0`
- appservice > bot > username, displayname, avatar > have some fun
- backfill > enabled > `true` (fetch old / missed messages)
- double_puppet > secrets > `[your-matrix-domain]: as_token:[your-token]` (as_token from `/your-data-dir/synapse/doublepuppet.yaml`)
- encryption > allow > `true` (why isn't this the default?)
- encryption > default > `true` (why isn't this the default?)

When finished, restart the container to regenerate a custom `registration.yaml` for your config:
```
docker restart mautrix-slack
```

Navigate to `/your-data-dir` and copy the `registration.yaml` file to the Synapse data directory with a unique name. Change ownership to match your Docker user for Synapse. Do this as root.
```
cp ./mautrix-slack/registration.yaml ./synapse/mautrix-slack-registration.yaml
chown [user-id]:[group-id] ./synapse/mautrix-slack-registration.yaml
```

Navigate to `/your-data-dir/synapse` and edit `homeserver.yaml`. Add an app service config line for `/data/mautrix-whatsapp-registration.yaml`. This will register the bridge as an appservice on your Matrix Synapse server.
```
app_service_config_files:
...
- /data/mautrix-whatsapp-registration.yaml
...
```

Restart Synapse for the config changes to take effect. Then restart the bridge.
```
docker restart matrix-synapse
docker restart mautrix-slack
```

To test the bridge, start a chat with the bot, e.g. `@slackbot:server.example.com`, and say `help`. Be sure to use your actual Matrix server domain.

Chat account login info: https://docs.mau.fi/bridges/go/slack/authentication.html  
Full bridge documentation: https://docs.mau.fi/bridges/general/docker-setup.html?bridge=slack

## Matrix / SMS bridge config

SMS/MMS text message bridging is supported via the Google Messages app. This means, unfortunately, that it requires that you first send all of your text messages to Google before they can be intercepted by the bridge.

On your Matrix server, create a data directory for the bridge service inside `/your-data-dir`:
```
mkdir /your-data-dir/mautrix-gmessages
```

Create a database for the bridge on your `matrix-db` instance:
```
docker exec -e PGPASSWORD=<your-postgres-password> -it matrix-db \
  psql -U synapse -d postgres \
  -c "CREATE DATABASE \"mautrix-gmessages\";"
```

Docker compose for the [mautrix-gmessages](https://github.com/mautrix/gmessages) bridge:
```
services:
  mautrix-gmessages:
    container_name: mautrix-gmessages
    image: dock.mau.dev/mautrix/gmessages:latest
    restart: unless-stopped
    volumes:
    - /your-data-dir/mautrix-gmessages:/data
```

Start and stop the bridge to create a config file:
```
docker compose up -d
docker stop mautrix-gmessages
```

Edit the config file `/your-data-dir/mautrix-gmessages/config.yaml` according to the official documentation. There's a lot to configure.

Some required and/or useful options:
- network > displayname_template > `"{{or .FullName .PhoneNumber}} (SMS)"` (append SMS)
- network > aggressive_reconnect > `true` (keep priority over Google Messages Web)
- bridge > bridge_matrix_leave > `true` (sync leaving groups)
- bridge > permissions > @admin to your admin username, example.com to your matrix domain
- database > uri > `postgres://synapse:[your-super-sercret-password]@[your-server-IP]:8009/mautrix-gmessages?sslmode=disable`
- homeserver > address > `http://[your-server-IP]:8008`
- homeserver > domain > `[your-matrix-domain]`
- appservice > address > `http://mautrix-whatsapp:29318`
- appservice > public_address > `[your-matrix-domain]`
- appservice > hostname > `0.0.0.0`
- appservice > bot > username, displayname, avatar > have some fun
- backfill > enabled > `true` (fetch old / missed messages)
- double_puppet > secrets > `[your-matrix-domain]: as_token:[your-token]` (as_token from `/your-data-dir/synapse/doublepuppet.yaml`)
- encryption > allow > `true` (why isn't this the default?)
- encryption > default > `true` (why isn't this the default?)

When finished, restart the container to regenerate a custom `registration.yaml` for your config:
```
docker restart mautrix-gmessages
```

Navigate to `/your-data-dir` and copy the `registration.yaml` file to the Synapse data directory with a unique name. Change ownership to match your Docker user for Synapse. Do this as root.
```
cp ./mautrix-gmessages/registration.yaml ./synapse/mautrix-gmessages-registration.yaml
chown [user-id]:[group-id] ./synapse/mautrix-gmessages-registration.yaml
```

Navigate to `/your-data-dir/synapse` and edit `homeserver.yaml`. Add an app service config line for `/data/mautrix-whatsapp-registration.yaml`. This will register the bridge as an appservice on your Matrix Synapse server.
```
app_service_config_files:
...
- /data/mautrix-gmessages-registration.yaml
...
```

Restart Synapse for the config changes to take effect. Then restart the bridge.
```
docker restart matrix-synapse
docker restart mautrix-gmessages
```

To test the bridge, start a chat with the bot, e.g. `@gmessagesbot:server.example.com`, and say `help`. Be sure to use your actual Matrix server domain.

Chat account login info: https://docs.mau.fi/bridges/go/gmessages/authentication.html  
Full bridge documentation: https://docs.mau.fi/bridges/general/docker-setup.html?bridge=gmessages

## Matrix / WhatsApp bridge config

On your Matrix server, create a data directory for the bridge service inside `/your-data-dir`:
```
mkdir /your-data-dir/mautrix-whatsapp
```

Create a database for the bridge on your `matrix-db` instance:
```
docker exec -e PGPASSWORD=<your-postgres-password> -it matrix-db \
  psql -U synapse -d postgres \
  -c "CREATE DATABASE \"mautrix-whatsapp\";"
```

Docker compose for the [mautrix-whatsapp](https://github.com/mautrix/whatsapp) bridge:
```
services:
  mautrix-whatsapp:
    container_name: mautrix-whatsapp
    image: dock.mau.dev/mautrix/whatsapp:latest
    restart: unless-stopped
    volumes:
    - /your-data-dir/mautrix-whatsapp:/data
```

Start and stop the bridge to create a config file:
```
docker compose up -d
docker stop mautrix-whatsapp
```

Edit the config file `/your-data-dir/mautrix-whatsapp/config.yaml` according to the official documentation. There's a lot to configure.

Some required and/or useful options:
- network > displayname_template > `"{{or .FullName .BusinessName .PushName .Phone}} (WA)"` (full names from phone contacts with fallbacks to the rest, append WA)
- network > enable_status_broadcast > `false` (no user statuses, just chats)
- network > archive_tag > `m.lowpriority` (tag archived chats as low priority)
- network > whatsapp_thumbnail > `true` (use WhatsApp thumbnails)
- network > url_previews > `true` (generate URL previews)
- bridge > bridge_matrix_leave > `true` (sync leaving groups)
- bridge > permissions > @admin to your admin username, example.com to your matrix domain
- database > uri > `postgres://synapse:[your-super-sercret-password]@[your-server-IP]:8009/mautrix-whatsapp?sslmode=disable`
- homeserver > address > `http://[your-server-IP]:8008`
- homeserver > domain > `[your-matrix-domain]`
- appservice > address > `http://mautrix-whatsapp:29318`
- appservice > public_address > `[your-matrix-domain]`
- appservice > hostname > `0.0.0.0`
- appservice > bot > username, displayname, avatar > have some fun
- backfill > enabled > `true` (fetch old / missed messages)
- double_puppet > secrets > `[your-matrix-domain]: as_token:[your-token]` (as_token from `/your-data-dir/synapse/doublepuppet.yaml`)
- encryption > allow > `true` (why isn't this the default?)
- encryption > default > `true` (why isn't this the default?)

When finished, restart the container to regenerate a custom `registration.yaml` for your config:
```
docker restart mautrix-whatsapp
```

Navigate to `/your-data-dir` and copy the `registration.yaml` file to the Synapse data directory with a unique name. Change ownership to match your Docker user for Synapse. Do this as root.
```
cp ./mautrix-whatsapp/registration.yaml ./synapse/mautrix-whatsapp-registration.yaml
chown [user-id]:[group-id] ./synapse/mautrix-whatsapp-registration.yaml
```

Navigate to `/your-data-dir/synapse` and edit `homeserver.yaml`. Add an app service config line for `/data/mautrix-whatsapp-registration.yaml`. This will register the bridge as an appservice on your Matrix Synapse server.
```
app_service_config_files:
...
- /data/mautrix-whatsapp-registration.yaml
...
```

Restart Synapse for the config changes to take effect. Then restart the bridge.
```
docker restart matrix-synapse
docker restart mautrix-whatsapp
```

To test the bridge, start a chat with the bot, e.g. `@whatsappbot:server.example.com`, and say `help`. Be sure to use your actual Matrix server domain.

Chat account login info: https://docs.mau.fi/bridges/go/whatsapp/authentication.html  
Full bridge documentation: https://docs.mau.fi/bridges/general/docker-setup.html?bridge=whatsapp

---
*License: [CC BY-SA 4.0 Deed](https://creativecommons.org/licenses/by-sa/4.0/) - You may copy, adapt, and use this work for any purpose, even commercial, but only if derivative works are distributed under the same license.*

*Category: Software, Tools*