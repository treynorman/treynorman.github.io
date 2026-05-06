# Fireplace.html
*February 17, 2011*

## Overview

A cozy, crackling fireplace in your web browser. Use it to read, study, relax, or lock up your computer to avoid distractions.

[Demo](https://trey.zip/projects/fireplace/fireplace.html)

*(Instructions: Click the current time to make it crackle, Try it in full-screen mode!)*

## Gallery

[Gallery]()

## Details

Studying is hard. More specifically, staying focused while studying dull material is hard. Even the slightest sound can break my concentration, and libraries, while being some of the quietest places to study, won't cut it when other students come and out and rustle through their bags. I often listen to music to drown out the distractions. However, it’s hard to strike a balance between music that's boring enough to not distract me and music that's interesting enough that me disliking it doesn’t become a distraction.  
  
Enter Fireplace.html. Inspired by [The Yule Log TV program](https://en.wikipedia.org/wiki/Yule_Log_(TV_program)), I decided to build a crackling fireplace in my web browser to improve the ambiance of my study sessions and add a little white noise. The sound of the crackling wood would be just enough noise to keep me focused, and the fire dominating my laptop screen would hopefully keep me from taking breaks to browse the internet. I would run it full-screen in as seamless of a continuous loop as possible.  
  
I put down my books (yes, this project itself was a distraction from studying) and set out scouring the internet for supplies. I quickly found an animated GIF of a fireplace that looped perfectly. The crackling sound was a bit harder to come by, but I managed to find I a 52 minute long clip and cut it down to a 2.5 minute clip crafted for loopage. I used code from one of my old websites as a template and scaled the GIF to fill the background. Next, with some help from [JS Made Easy.com](http://jsmadeeasy.com/), I added a clock to the top right corner of the page and configured the crackling sound to play automatically on page load.
  
After a couple of wasted study session hours, Fireplace.html was complete. I’m happy to confirm that the page does help keep me focused although I sometimes have to add a little instrumental music if the library gets too noisy.  
  
**Update (April 2013)**: The Javascript I used to play the crackling sound is no longer reliable or compatible across browsers. I’ve opted to use the new HTML5 `<audio>` tag instead. The new method won’t work in old web browsers, but should work reliably moving forward. I've also changed the code to only trigger the crackling sound when the user clicks on the clock. I block autoplay these days.

## Download

[Download](fireplace/fireplace.zip)

---
*License: [CC BY-SA 4.0 Deed](https://creativecommons.org/licenses/by-sa/4.0/) - You may copy, adapt, and use this work for any purpose, even commercial, but only if derivative works are distributed under the same license.*

*Category: Software*
