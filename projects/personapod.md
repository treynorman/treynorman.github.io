# PersonaPod: Open Source AI News Podcast Generator
*February 6, 2026*

## Overview

Open source AI podcast generator that scrapes news articles and generates news segments using cloned voices and customizable personas. Runs locally on open source AI models with automatic Docker container management for efficient resource utilization (only 15 GB VRAM required).

[Demo](https://personapod.lol/)

## Video

[Video](https://www.youtube.com/embed/GH1NmKd2r3I)

## Background

The news cycle needs more positivity. Initially inspired by Bob Ross, my aim with [PersonaPod](https://github.com/treynorman/PersonaPod) was to deliver that positivity in short, easy to digest daily news podcasts. LLM's offer the ability to both draft news segments with less sensationalism and mimic a defined personality. Modern TTS models offer the ability to clone familiar voices.

TTS was the primary challenge for this project, and I kept this idea on the back burner for about a year while I experimented with new TTS models. While numerous models offer voice cloning in inference, few of them deliver high quality, consistent results. Even fewer models have the ability to mimic timbre and background noise. It's far more common that a TTS model demands clean and clear voice samples and outputs clean and clear speech, making it nearly impossible to mimic something like a 1920's transatlantic style broadcast.

In late 2024, a lesser known TTS model called [MaskGCT]([https://maskgct.github.io/](https://maskgct.github.io/)) was released and performed spectacularly for my needs. However, the model was only capable of delivering short audio segments, contained broken dependencies, wasn't quite ready for production. On my first day working with it, I built a Docker framework to resolve all dependency issues at build time and allow API access to the MaskGCT demo. I also built a chunker to break long text segments into smaller chunks that MaskGCT could process, generate speech from text chunk, then merge all of the generated audio clips together using ffmpeg.

In early 2025, I wrote code to fetch news article text from any news RSS feed and transform it into a news segment using an open source LLM running inside a llama.cpp Docker container. The news segment could then be covered to speech using a cloned voice with [my MaskGCT Docker container]([https://github.com/treynorman/MaskGCT-Docker](https://github.com/treynorman/MaskGCT-Docker)). Because my GPU isn't capable of running both the LLM and TTS Docker containers simultaneously, I also added functions to start and stop each container during generation.

Turning the news segments into a podcast is pretty straightforward. Since podcasts are fundamentally just RSS feeds that link to MP3 files online, my final step was to find a public web host for those MP3's. Cloudflare offers a generous free tier for hosting the podcast. The last bit of code I wrote converts the output WAV files to MP3 VBR 2 and manages uploading generated podcast episodes to Cloudflare. It also updates the publicly accessible podcast RSS feed with entries for newly generated episodes. To demo the project, I built a simple web app to read the podcast RSS feed and play it in a web browser. 

Although PersonaPod was functionally complete by late February 2025, it was still a bit too hacked together to be presentable. I shelved it for a while. In December 2025, I cleaned up the code to launch the project. I also added a function to overlay background tracks – with the ability to offset them for use as and intro and fade them out – making the completed episodes much more vibrant.

### Models & Services Employed

**[MaskGCT: Zero-Shot Text-to-Speech with Masked Generative Codec Transformer](https://maskgct.github.io/)**

MaskGCT is a highly performant text-to-speech (TTS) model with the ability to clone voices in inference using a voice clip ~5-10 seconds long.

Unlike models built on an autoregressive / diffusion decoder architecture, MaskGCT does not require clean voice samples or use a denoising processes to generate outputs. As a result it is able to preserve the microphone dynamics, tone, and overall ambiance of the voice sample. Rather than erroneously matching features like room dynamics or environment noise, failing to clone the provided voice sample, MaskGCT is far less sensitive and reliably matches inputs.

MaskGCT was not released in a Docker container or designed to run as a service on the local network. I've provided a container to encapsulate it, making it accessible on the local network via API.

**[Qwen3-32b: Reasoning LLM with Hybrid Thinking Modes](https://huggingface.co/Qwen/Qwen3-32B)** (used in demos)

Qwen3 is a series of open source LLMs from Alibaba with reasoning capabilities that can be enabled or disabled through prompting.

Qwen3-32b with 4-bit quantization has been tested for LLM inference and performs well for both summarization and persona preservation with thinking mode enabled. It consumes nearly 24 GB of VRAM during operation. Smaller LLMs can be used on systems with tighter hardware constraints.

**[llama.cpp: LLM inference in C/C++](https://github.com/ggml-org/llama.cpp)**

llama.cpp is used to run large language models (LLMs) locally. It is fast, robust, and fully free and open source. Since llama.cpp uses an Open AI compatible API, LLM API calls in this project can easily be pointed to another service with minor modification to the code base.

**[Cloudflare R2 Free Tier: S3-compatible Object Storage](https://www.cloudflare.com/developer-platform/products/r2/)**

Cloudflare R2 offers a very generous free tier for hosting the generated podcast, making it publicly accessible. With MP3 VBR-V2 compression for the podcast audio, multiple years of daily news podcast episodes can be hosted for free.

**[Docker](https://www.docker.com/)**

Docker containers are used for all AI services in this project. LLM and TTS containers are started and stopped as needed, allowing the largest possible models to be used on systems with limited VRAM.

## Technical Details

The system processes news through several stages to generate a podcast episode:
1. Grab the latest news from any news website RSS feed
2. Follow news article links and extract the text
3. Use llama.cpp to summarize the top N news articles
4. Generate a news segment with llama.cpp using a defined persona
5. Use MaskGCT to clone a voice and deliver the news segment by chunking and stitching generated voice clips
6. Add background music with configurable initial offset fade-out duration
7. Compress final output with MP3 VBR 2 compression for performance and minimal host server load
8. Maintain a publicly accessible news podcast RSS feed (Cloudflare free tier)

Since the project is designed to run locally on a single GPU, managing the resource requirements of the AI models is crucial. To address this, I implemented a container orchestration system that swaps between local LLM and TTS models during podcast generation. This allows PersonaPod to run on consumer hardware while still utilizing state-of-the-art open source AI models.

The project includes a web podcast player for browser-based listening and maintains a podcast RSS feed that updates with new episodes. For daily automation, a cron job can be configured to generate new episodes at scheduled times.

While the number of moving parts makes installation somewhat complex, I've provided detailed documentation and Docker containers to simplify the process. The MaskGCT model, in particular, required creating a custom Docker container to expose its API for network access.

PersonaPod is released as an open source project under the MIT license, inviting others to experiment with different personas and voices. The potential applications extend beyond news delivery to educational content, storytelling, and more. Any RSS feed can be converted into a podcast.

## Installation & Setup

Build and run a MaskGCT inside Docker container.

MaskGCT does not include a native Docker container. I've provided a Dockerfile that builds and encapsulates the project, resolves dependency issues, and exposes the Gradio app API to listen on all network interfaces. 

This MaskGCT Dockerfile is provided in a [separate GitHub repo](https://github.com/treynorman/MaskGCT-Docker).
```
git clone https://github.com/treynorman/MaskGCT-Docker
cd "MaskGCT-Docker"
docker build -t Amphion/mask-gct .
docker run --runtime=nvidia --privileged --cap-add=ALL --name mask-gct -p 2121:2121 -p 2222:4200 -p 7860:7860 -d Amphion/mask-gct
```

Clone this GitHub repo.
```
git clone https://github.com/treynorman/PersonaPod
```

Create and activate a virtual environment for the project. Then, install all dependencies from `requirements.txt`.
```
cd PersonaPod
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

[Install ffmpeg](https://www.ffmpeg.org/download.html), e.g. for Debian based Linux systems:
```
sudo apt install ffmpeg
```

Create a public Cloudflare R2 bucket for hosting the podcast. Take note of the Cloudflare account ID, bucket name, and API keys.
1. In the Cloudflare dashboard, go to the R2 object storage page, go to **Overview**
2. Select Create bucket.
3. Enter the bucket name, e.g. `ai-news-pod`
4. Select Create bucket.
5. Go to **Object Storage** > **Manage API Tokens**
6. Create a **Custom API Token**

Upload the podcast player web application and image assets to the Cloudflare R2 bucket.
```
├── assets
│   ├── kmart-radio.jpg
│   ├── main-image.jpg
│   └── rss-parser.min.js
├── favicon (optional)
│   ├── apple-touch-icon.png
│   ├── favicon-16x16.png
│   ├── favicon-32x32.png
│   ├── favicon-96x96.png
│   ├── favicon.ico
│   ├── favicon.svg
│   ├── site.webmanifest
│   ├── web-app-manifest-192x192.png
│   └── web-app-manifest-512x512.png
└── index.html
```

Configure the project using the template provided in `.env`.

Below is an overview of the required environment variables:
1. RSS feed for news articles & number of top stories to use.
2. Cloudflare account ID, bucket name, and API keys.
3. AI Docker container names, boot wait times, and any *excluded containers* which will remain running during AI operations.
4. llama.cpp API base URL and key (any OpenAI compatible LLM API will work)
5. MaskGCT API base URL, path to voice samples directory, and voice sample filenames.
6. Podcast episode background tracks directory and background track filenames.
7. Podcast assets directory on local machine for storing generated episodes and RSS feed XML file.
8. Podcast title, description, and RSS feed filename.
9. Podcast cloud repo base URL and relative links to images used in the podcast feed.
10. Define a custom environment variable for your AI persona with a path to the system prompt TXT file. `SYSTEM_CHARACTER_KMART_RADIO` is provided as an example.

Define a custom prompt for your podcast persona. An example persona prompt is provided in `prompts/system_character_kmart_radio.txt`.

### Usage

Inside `main.py` use the `create_episode` function to configure the podcast. This function will pull the latest news, manage local AI containers to generate the episode, upload the episode to cloud storage, and update the podcast RSS feed.

**Required Arguments:**
*   `character_system_prompt` (str): Defines the character's personality.
*   `character_voice_ref` (str): Path to the voice sample.
*   `episode_image` (str): Path to the remote image.
*   `title` (str): Episode title.

**Optional Arguments:**
*   `bg_track` (str): Path to the background track.
*   `tts_start_delay_ms` (int): Delay before podcast voice starts (ms).
*   `fade_duration_s` (int): Fade out duration for background track (s).

**Example:**
```python
create_episode(
    c.SYSTEM_CHARACTER_KMART_RADIO, 
    c.MASKGCT_VOICE_REF_KMART_RADIO, 
    c.PODCAST_EPISODE_IMAGE_URL_KMART_RADIO, "Kmart Radio News", 
    c.BG_TRACK_KMART_RADIO, 12000, 5)
```

**Run main.py to Generate Podcast Episodes:**
```
source venv/bin/activate
python3 main.py
```

**(Optional) Update Podcast Daily Using a Cron Job:**

Create a script, e.g. `update-podcast.sh`, to run generate new podcast episodes. Be sure to use absolute paths to active the virtual environment and run the code.
```
#!/bin/bash

cd /absolute/path/to/PersonaPod
source venv/bin/activate
python3 main.py
```

Then create a cron job to run the script on a daily schedule, e.g. at 7am each day, and write output to `update-podcast-cron.log` by following the instructions below.

Run `crontab -e` and add this line, using absolute paths to the project files on your system.
```
0 7 * * * /absolute/path/to/PersonaPod/update-podcast.sh >> //absolute/path/to/PersonaPod/update-podcast-cron.log 2>&1
```

## Project GitHub

[Download](https://github.com/treynorman/PersonaPod)

---

*License: [MIT License]([https://opensource.org/licenses/MIT](https://opensource.org/licenses/MIT)) - Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files.*

*Category: Software*