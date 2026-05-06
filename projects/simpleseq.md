# SimpleSeq MIDI Sequencer
*August 7, 2011*

## Overview

SimpleSeq is a MIDI sequencer designed to be used as an instrument or drum machine. It can trigger notes and sounds on a synthesizer, VST plug-in, or any sound generating device that supports the MIDI protocol.

**Time Invested**: 3 weeks  
**Cost**: $15  
**Features**:  
 - Two-note polyphony
 - Velocity control for each note
 - Tempo control
 - Pitch shifting
 - 8 and 16-step sequencing
 - 8 assignable MIDI CC controls

## Video

[Video](https://www.youtube.com/embed/PCJX-Pf_M4Q)

## Details

This project is based off of [Michael Roebbeling's SimplenZAR](http://www.roebbeling.de/wordpress/?p=85), which I modified and made my own. Below is a list of changes I made and features I added.

For the circuit, I...

*   Added a second button for navigation  
    _\- \[left\]-\[enter\]-\[right\] instead of \[select\]-\[enter\]_
*   Embedded the microcontroller and power supply into the circuit
*   Used brighter LEDs with 220 Ohm current-limiting resistors

For the firmware, I...

*   Rewrote the "loop" section of the code, so the device is constantly checking for user input (every 10ms), not just when notes are played  
    _\- the original device would "freeze" in between every note, which became a major problem at slow tempos_  
    _\- from what I now understand, what I did was essentially event-driven programming_
*   Added the ability to navigate forward and backward through steps and menus
*   Added the ability to play two notes simultaneously (aka. two-note polyphony)
*   Added the ability to store presets in EEPROM (three total)
*   Added the ability to control eight [MIDI CC functions](https://www.midi.org/specifications/item/table-3-control-change-messages-data-bytes-2) (eg. filter cutoff frequency, resonance, portamento, etc.)
*   Added the ability to mute all notes  
    _\- helpful when assigning MIDI CC functions in Ableton, etc._
*   Changed the way tempo is set (using BPM, rather than milliseconds of delay), and constrained the range from 60 to 300 BPM
*   Changed the way new notes start when added to a sequence  
    _\- repeats the previous note, instead of always playing a C_  
    _\- this keeps the user from hearing a wrong note when C is not in-key_
*   Simplified parts of the original code

The sequencer is still breadboarded and looks pretty ugly ever since I embedded the microcontroller, but it works just fine. You can find the source code and a hand-drawn schematic of the circuit below.


## Gallery

[Gallery]()

## Download

**Source Code:**

[Download](https://pastebin.com/Dg9SPRMc)

**Schematic:**

[Download](simpleseq/schematic.jpg)

---
*License: [CC BY-SA 4.0 Deed](https://creativecommons.org/licenses/by-sa/4.0/) - You may copy, adapt, and use this work for any purpose, even commercial, but only if derivative works are distributed under the same license.*

*Category: Software, Hardware*