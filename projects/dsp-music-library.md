# Music Library Loudness Leveling DSP
*November 9, 2019*

## Overview

Broadcast grade loudness leveling to ensure consistent volume across playlist tracks. Brings out subtle harmonies and counter-melodies, which may be inaudible in poor playback conditions.

## Gallery

[Gallery]()

## Details

I'll preface this with a disclaimer: I'm an audiophile who prefers to listen to music as it was recorded. And listen on equipment that preserves the original mastering. 

However, in many listening environments and low-end speakers – cars, Bluetooth speakers, most soundbars – harmonies and counter-melodies get buried in the noise floor. Additionally, albums tend to be mastered to different peak loudness levels with varying levels of dynamic range compression. That's fine when listening to a single album from start to finish, but loudness variation between tracks in a playlist can be frustrating.

It is well established that [louder songs sound better](https://gizmodo.com/loudness-sounds-better-it-s-also-ruining-music-1694020336), a cognitive bias everyone is susceptible to. This phenomenon has fueled a [loudness war](https://en.wikipedia.org/wiki/Loudness_war) in the music industry, where tracks are increasingly compressed and limited to sound louder. As a result, listening to music across different eras can be jarring, as the loudness and perceived quality vary greatly.

I was an audio engineer and DJ at my university student radio station. There, we had an audio post-processing rack to address this problem. Our post-processing rack used a multi-band compressor and limiter to normalize all audio broadcast from the station without noticeably coloring it. At home, I achieved the same results (in fact, better) using fantastic piece of software called [DSP Stereo Tool](https://www.thimeo.com/). But unfortunately, the Stereo Tool cannot be used on a smartphone, stereo, or in a car – only on a computer.

Today, I decided to flip the script. I'm one of the few people left who prefers to purchase digital music files rather than stream them. Payouts to artists are better for purchases, purchases never disappear from my library during licensing disputes, and the audio quality on streaming sites is often lower than advertised. So until I get around to building my own loudness normalizing DSP hardware to process audio in real-time, why not pre-process my music library?


## Music Library DSP Loudness Normalization

The script below uses [DSP Stereo Tool](https://www.thimeo.com/) to apply broadcast grade loudness normalization to a full library of music. It expects directory called `Library`. It copies the full Library sub-directory structure into a new directory `Library-DSP`. Every MP3 file from the library is converted to WAV, processed, then converted back to MP3. All metadata from the original MP3 is mapped to the new one. Comment metadata is added to indicate the addition of DSP processing and the date processed. After processing all files, an integrity check identifies any failed conversions. This is important, because the script might take over 24 hours to run. Stereo Tool is a high quality processing rack, not a fast one.

**Requirements:**
- Stereo Tool software license
- command line version of Stereo Tool [available for download here](https://www.thimeo.com/stereo-tool/)
- stereo_tool_cmd_64 -k requires LICENSE KEY string, "< >" chars are required
- stereo_tool_cmd_64 -s requires a preset file with preconfigured DSP settings

The script is technically lossy, and it targets MP3 files rather than FLAC. This is because my primary use case for the processed library is music playback on my phone, which doesn't have enough storage for a FLAC library. Feel free to change all instances of ".mp3" to ".flac" to adapt it.

```
#!/bin/bash

# Create new root directory
mkdir -p "Library-DSP"

# Recreate directory structure
find Library -type d -print0 | while IFS= read -r -d '' dir; do
    # Replace "Library" with "Library-DSP" in the path
    new_dir="${dir/Library/Library-DSP}"
    mkdir -p "${new_dir}"
done

# Copy files while preserving structure
find Library -type f -print0 | while IFS= read -r -d '' file; do
    # Replace "Library" with "Library-DSP" in filepath for output file
    out_file="${file/Library/Library-DSP}"
    
    # Create temporary filenames for files used in processing steps
    temp_file1="${out_file%.mp3}.wav"
    temp_file2="${out_file%.mp3}-DSP.wav"
    temp_file3="${out_file%.mp3}-temp1.mp3"

    echo "-- Processing ${file} --"

    # Convert MP3 to WAV, process WAV with DSP Stereo Tool, convert WAV to MP3 VBR 0
    # - ffmpeg -nostdin flag required to prevent user prompts from breaking the script
    # - stereo_tool_cmd_64 -k requires LICENSE KEY string, "< >" chars are required
    # - stereo_tool_cmd_64 -s requires a preset file with preconfigured DSP settings
    # - only output error messages
    ffmpeg -nostdin -loglevel level+error -hide_banner -nostats -i "${file}" -acodec pcm_s16le -ar 44100 "${temp_file1}"
    ./stereo_tool_cmd_64 -q -k "<LICENSE-KEY>" -s Default.sts "${temp_file1}" "${temp_file2}" | grep -i "error"
    ffmpeg -nostdin -loglevel level+error -hide_banner -nostats -i "${temp_file2}" -q:a 0 "${temp_file3}"
    
    # Copy metadata from old MP3 to new MP3, set Comment metadata to show date processed
    ffmpeg -nostdin -loglevel level+error -hide_banner -nostats \
    -i "${file}" -i "${temp_file3}" \
    -map_metadata 0 -map 1:a -map 0:v \
    -metadata comment="DSP on $(date +%F)" \
    -id3v2_version 3 -write_id3v1 1 -c copy "${out_file}"

    
    rm "${temp_file1}"
    rm "${temp_file2}"
    rm "${temp_file3}"

done

# Check for missing files in Library-DSP (e.g. failed conversions)
echo
echo "---------------------"
echo "-- Integrity Check --"
echo "---------------------"
echo
rsync -r --dry-run --itemize-changes --ignore-existing Library/ Library-DSP/
```

---
*License: [CC BY-SA 4.0 Deed](https://creativecommons.org/licenses/by-sa/4.0/) - You may copy, adapt, and use this work for any purpose, even commercial, but only if derivative works are distributed under the same license.*

*Category: Software*