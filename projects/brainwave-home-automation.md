# Brainwave Controlled Home Automation
*January 18, 2012*

## Overview

DIY solution to control room lights with brainwave activity, voice commands, and smartphone. Includes custom integration with smartphone alarm clock to sync wake-up time with sleep cycles, gently turn on the lights, speak the morning weather, and play music on the stereo.

**Time Invested**: 4 days  
**Cost (Outlet Remote)**: $25  
**Cost (Mindflex EEG)**: $40  
**Features**:  
 - Control lights with brain, voice, smartphone, computer
 - Alarm clock integration with sleep cycle optimization
 - Spoken morning weather forecast & music

## Video

[Video](https://www.youtube.com/embed/Z96_WUoB1XA)

[Video](https://www.youtube.com/embed/XS7_zMwWjC4)

## Details

Ever since I watched the Disney Channel original movie "[Smart House](https://www.youtube.com/watch?v=RxUZb3WnTpo)" as a kid, I've been determined to build a real smart house for myself. In the summer of 2011, I purchased a wireless outlet controller with three switched outlets at my local hardware store. It was a low-cost RF system with no capability for WiFi control, but my intention was to change that.

Just before the beginning of the spring semester I cracked open the remote control to figure out how it worked and, more importantly, figure out how to emulate button presses with a microcontroller. After a bit of experimentation and probing, I found an array of diodes on the circuit board where a HIGH signal could be introduced to emulate a button press. I soldered on a few leads, wrote an Arduino sketch to translate commands from my computer, and used that data to toggle the three wireless switches in my room.

Having been recently introduced to the automation tool [EventGhost](http://www.eventghost.net/) while configuring a network remote for [XBMC](https://xbmc.org/), I chose it to expand the capabilities of my light controller. Inside EventGhost, I configured macros to send serial data to my light controller in response to key combinations on my keyboard. Next, I leveraged the EventGhost [Android app](https://github.com/timhoeck/eventghost-android) to control my lights with my phone and employed the EventGhost [SpeechRecognition plugin](http://www.eventghost.net/forum/viewtopic.php?f=1&t=18&start=30) to control my lights with my voice. Inspired by a video I saw in late 2011 called [Brain Hack](https://vimeo.com/10184668), I also resolved to control my lights with my brain. I didn't expect it to be a practical means of control by any stretch of the imagination, but it was fun to add as a proof of concept. I acquired a Mattel Mindflex, found the Neurosky EEG module inside, and grabbed serial data from it using Erik Mika's [brain library for Arduino](https://github.com/kitschpatrol/Arduino-Brain-Library). Using that data I was able to control my lights using the brainwave activity in my prefrontal cortex.

The last feature I added was an alarm clock function. I configured macros in EventGhost that, when triggered by the Android app, set a timer for 194, 374, or 464 minutes and ran an alarm clock function after the timer ran out. (Those times were selected based on a 90 minute sleep cycle and the fact that the average person takes 14 minutes to fall asleep – the same reasearch based assumptions used in the [sleepyti.me bedtime calculator](https://sleepyti.me/).) The alarm starts by quietly playing a song from my "wake up" playlist and turns on LED Christmas lights to wake me up gently. Next, it gets the local forecast from Google using the [EventGhost Weather plugin,](http://www.eventghost.net/forum/viewtopic.php?f=9&t=1996) speaks the weather aloud using text-to-speech, and tells me the current time. Finally, it increases the music volume to "time to get up" levels and turns on the rest of my lights. Using [Tasker](https://tasker.joaoapps.com/) I configured this entire process to be triggered by setting a regular alarm on my phone.

## Gallery

[Gallery]()

---
*License: [CC BY-SA 4.0 Deed](https://creativecommons.org/licenses/by-sa/4.0/) - You may copy, adapt, and use this work for any purpose, even commercial, but only if derivative works are distributed under the same license.*

*Category: Hardware, Software*
