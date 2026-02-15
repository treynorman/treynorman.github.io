# Install MediaMonkey on Linux with Wine
*March 4, 2024*

This is a guide for installing the 64-bit version of MediaMonkey on Linux using Wine.

MediaMonkey is widely considered to be the best tool for managing music collections. It's a media player built to expand upon the legendary tool WinAmp. MediaMonkey enables users to:
- Bulk edit and correct song title, artist, album, track number, genre, and  other metadata
- Write changes back to the original files, supporting all three MP3 metadata versions to ensure that your hard work and changes aren't ignored by music players that to pull information from one specific version
- Embed album art directly into music file metadata, so that it's always displayed when a song is played on another device or media player
- Automatically organize files in a music collection accoring to a user-defined format, like
    - Artist / Album / Track# - SongTitle
    - Artist / Album [Year] / Track# - SongTitle
    - Genre / Artist / Album / Track# - SongTitle
    - Playlist Name / PlaylistPosition# - Artist - SongTitle
    - ...
- Use a wide collection of extensions to
    - Pull information from the internet like lyrics and album art
    - Bulk rename files and metadata to, for instance, add a leading zero to track numbers since silly computers sort songs in the order 1, 10, 11, 2, 3, 4, ..., when there's no leading zero
    - Run an internet radio server to stream your own internet radio station from inside MediaMonkey
    - Use digital signal processing to process the audio and, for instance, normalize the loudness of all music played back with a compressor + limiter

That sounds like an ad, but really it's a call to action for someone to build a modern tool with the same level of functionality. Since no such tools exist, running this old powerhouse using Wine is the best option. 

This tutorial targets MediaMonkey 3, because it has the largest number of community extensions available for enhanced functionality. [Download the final version of MediaMonkey 3 from the MediaMonkey website.](https://www.mediamonkey.com/support/knowledge-base/mediamonkey-general/download-mediamonkey/)

## Install Wine

If missing, install `wine` and `winetricks` after adding the WineHQ repo:
```
sudo dpkg --add-architecture i386
sudo mkdir -pm755 /etc/apt/keyrings
sudo wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key
sudo wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/debian/dists/$(lsb_release -cs)/winehq-$(lsb_release -cs).sources
sudo apt update
sudo apt install --install-recommends winehq-stable
```

Run `winecfg` and select Windows 7 as the Windows Version for running applications in Wine:
```
winecfg
# Applications > Windows Version > Windows 7 > Apply
```

Note: When wine breaks, the easy nuclear option is to purge every portion of it, including the default wine prefix:
```
sudo apt purge 'wine*'
sudo apt autoremove --purge
sudo rm -r ~/.wine
```

Then reinstall, maybe opting for an older stable version.

## Configure Winetricks

Run `winetricks` to install supporting Windows components and libraries.

- Choose **Select the default wine prefix** 
- Select **Install a Windows DLL or component** and add these components / libraries
    - ole32 (for RegExpReplace file renamer plugin)
    - oleut32 (for RegExpReplace file renamer plugin) 
    - vb6run 
    - vcrun6
    - vcrun6sp6
    - wmp11
    - wsh57
- Follow the prompts to complete installation
- Click **Cancel** after installation is complete

## Install MediaMonkey

Open a terminal in the same directory as the MediaMonkey installer. Then, use wine to install MediaMonkey with support for 64-bit Windows architectures and follow the prompts:
```
WINEARCH=win64 wine MediaMonkey_3.2.6.1307.exe
```

I use the final version of MediaMonkey 3, because it has the largest number of community add-ons and scripts by a long shot. [You can download MediaMonkey_3.2.6.1307 from the official site using this link](https://www.mediamonkey.com/support/knowledge-base/mediamonkey-general/download-mediamonkey/). Later versions of MediaMonkey break extension compatibility.

Follow the prompts to install MediaMonkey.

## Configure MediaMonkey

You might be disappointed to learn that MediaMonkey won't play music after it's installed. Not a good look. This is because MediaMonkey's default sound output plug-in isn't supported by Wine and must be changed.

Open MediaMonkey and navigate to **Tools > Options > Output Plug-ins**

Select **waveOut output v2.0.2a** and click **Configure**

Select the device **PulseAudio** (or your specific Linux version's audio driver). You may also disable volume controls inside of MediaMonkey since most Linux distros have their own volume mixer.

Click **OK** in both settings windows to exit.

## Optional: Keyboard shortcut to fully shut down MediaMonkey

Annoyingly, MediaMonkey will likely throw a memory error when you try to exit the application. The window will close, but the application will remain running in the background as a zombie process. The old process must be killed before MediaMonkey can be used again. To save time fiddling with the task manager, we can make a killswitch to force kill the app using a keyboard shortcut.

First create a script in your user's PATH to make it easy to run from the terminal. On my machine, this means adding the script to the folder ```~/.local/bin```:
```
nano ~/.local/bin/Kill-MM.sh
```

Paste the contents of the script below and save the file:
```
#!/bin/bash

# List all processes, find processes that contain the string "MediaMonkey", extract the first PID
PID=$(ps -aux | grep MediaMonkey | grep -oE '[0-9]+' | head -n 1)

# Kill the process
kill -9 ${PID}
```

Make the script executable:
```
chmod +x ~/.local/bin/Kill-MM.sh
```

Note: You can run ```echo $PATH``` to view a list of directories in your PATH and ensure that ```~/.local/bin``` is included. If it isn't, create the script inside a directory that is.

For ease of use, it's also helpful to add a keyboard shortcut to run the script. I use the key combination **Ctrl+Super+M**. On my machine, a keyboard shortcut can be created by navigating to **Settings > Keyboard > Application Shortcuts > + Add**.

## Optional: Create application launcher for MediaMonkey (non-skinned)

Skinned versions of MediaMonkey look goofy compared to modern UI's. Follow the instructions below to create an application launcher for the non-skinned version of MediaMonkey.

Create an app launcher for the non-skinned version of MediaMonkey:
```
nano MediaMonkeyNS.desktop
```

Paste the following as a template. Edit it to reference your home directory and MediaMonkey icon and save:
```
[Desktop Entry]
Name=MediaMonkey (non-skinned)
Type=Application
Categories=Audio;
Terminal=false
StartupNotify=true
Exec=env wine "/home/<your-username>/.wine/drive_c/Program Files (x86)/MediaMonkey/MediaMonkey (non-skinned).exe"
Comment=It really whips the llama's ass
Icon=AE5D_MediaMonkey.0
```

The tag ```<your-username>``` in the ```Exec=``` entry should be your Linux username.

```Categories=Audio;``` will ensure that MediaMonkey is listed alongside other audio apps in the application menu. Otherwise, it gets buried inside three directories, Wine > Programs > MediaMonkey, and that's too much effort.

```Comment=It really whips the llama's ass``` is a throwback to [WinAmp](https://youtu.be/O32cH075LBQ?si=z293QsQSFnY6KI3m). This is not strictly required, but encouraged.

```Icon=AE5D_MediaMonkey.0``` almost certainly won't work for anyone other than me. Your icon reference can be copied from the standard MediaMonkey application launcher. Use this command to view it:
```
cat MediaMonkey.desktop
```

A custom icon can also be used by referencing the absolute path of a SVG or PNG file without quotes.

Log out and log back in for these changes to take effect.

---
*Category: Notes, Software*
