# XFCE Panel: MacOS-like Launchpad Behavior
*April 16, 2023*

## Overview

Clicking an app in the XCFE panel often opens new instance of an app, even when the app is already running. For me, that's a bug. In macOS for instance, clicking a running app in launchpad shifts focus to that app. Here's how to make XFCE panel behave more intuitively.

## Gallery

[Gallery]()

## Script: Activate Don't Duplicate

Create a script like the one below for each app in your XFCE panel:
```
#!/bin/bash

# Check if "Firefox" is in any window title
if wmctrl -l | grep -q "Firefox"; then
    # Get window ID from wmctrl -l
    running_app=$(wmctrl -l | grep "Firefox" | head -n1 | awk '{print $1}')
    # Activate the already running app
    wmctrl -i -a "$running_app"
else
    # Original XFCE Launcher command from Properties > Edit Launcher
    exo-open --launch WebBrowser
fi
```

The script requires `wmctrl` which may not be installed:
```
sudo apt install wmctrl
```

Save the script wherever you want. Make sure it's executable:
```
chmod +x /wherever/you/want/script.sh
```

In the example script, change "Firefox" in all `grep` commands to match the relevant window title of the target app. You can hover over a running app in the toolbar to see its window title. The title will be long and specific to a browser tab title, filename, etc, but all that matters is the app name. `grep "<window-title>"` only matches the part of the title you specify. Alternatively, the command `wmctrl -l` will list all open windows.

Open the panel launcher item's config to grab the default command that's run with each clic. Add it after the `else` statement of the script. Then, change launcher command to use your script. In other words:
- Right click on the app icon
- Click "Properties"
- Click icon "Edit the currently selected item"
- "Edit Launcher" window will open
- Command: Add the existing command to the script
- Command: `/wherever/you/want/script.sh`

---
*License: [CC BY-SA 4.0 Deed](https://creativecommons.org/licenses/by-sa/4.0/) - You may copy, adapt, and use this work for any purpose, even commercial, but only if derivative works are distributed under the same license.*

*Category: Notes, Software*