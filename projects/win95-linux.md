# Windows 95 Theme & Flying Toasters Screensaver on Linux
*April 15, 2023*

## Overview

Take a ride in the Wayback Machine and get a highly responsive, minimalist, retro UI for your PC!

## Gallery

[Gallery]()

## Chicago95 Install

Rather than copy the documentation here and risk it being out of date in the future, I recommend following the official instructions for automated install. Don't sleep on [LibreOffice](https://www.libreoffice.org/) customization to get that Windows 95 look and feel in all of your office apps.

Chicago95 theme GitHub repo: [https://github.com/grassmunk/Chicago95](https://github.com/grassmunk/Chicago95)

## Windows 95 Style Weather Widgets

Install the XFCE weather widget:
```
sudo apt install xfce4-weather-plugin
```

Download the Windows 95 weather icons pack at the end of this section. Copy the included icon folders into the location `~/.config/xfce4/weather/icons/Chicago95/` (you'll need to create that directory inside the icons folder) and restart the widget. The new icon theme will be available under **Properties > Appearance > Icon Theme**.

If you'd like to swap out the icons or simply don't trust my ZIP file, grab some icons from [Chicago95 Extras](https://github.com/grassmunk/Chicago95_Extras), then use the script below to convert SVG's to PNG:
```
#!/bin/bash

mkdir -p {22,48,128}

cd svg
for i in *.svg;
do
  name="${i[@]/%svg/png}"

  # Convert SVG into icon sized PNGs
  inkscape -w 22 -h 22 "$i" -o ../22/"$name"
  inkscape -w 48 -h 48 "$i" -o ../48/"$name"
  inkscape -w 128 -h 128 "$i" -o ../128/"$name"

done
```

[Download](win95-linux/win95-weather-icons.zip)

## Flying Toasters Screensaver Install

If your Linux distro doesn't come with [XScreenSaver](https://www.jwz.org/xscreensaver/screenshots/), install it. Omit the asterisk if you don't want all of the screensavers. The full package is only ~40 MB and includes [3D Maze](https://www.youtube.com/watch?v=VTAwxTVdyLc), so:
```
sudo apt install xscreensaver*
```

This [GitHub repo](https://github.com/torunar/flying-toasters-xscreensaver/releases) has a more authentic Flying Toasters screensaver than version included in XScreenSaver. Download it. Move it to your local binaries folder:
```
sudo mv flying-toasters /usr/local/bin/flying-toasters
```

Add the path of the `flying-toasters` binary to the `programs:` section of the XScreenSaver config file `~/.xscreensaver`. Either do this manually using a text editor or automatically using the command below:
```
sed -i '/^programs:/a\                                /usr/local/bin/flying-toasters              \\n\\' "$HOME/.xscreensaver"
```

---
*License: [CC BY-SA 4.0 Deed](https://creativecommons.org/licenses/by-sa/4.0/) - You may copy, adapt, and use this work for any purpose, even commercial, but only if derivative works are distributed under the same license.*

*Category: Notes, Software*