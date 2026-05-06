# Coffee Roasting
*February 15, 2021*

## Overview

Home coffee roasting from basic heating to temperature rate control, Maillard reaction and caramelization phase modulation, and a basis for PID control.

## Video

[Video](https://www.youtube.com/embed/9BxUGKazajo)

[Video](https://www.youtube.com/embed/0QRqdFm72Z0)

## Background

I’ve been a coffee lover as long as I can remember. Over the years, I’ve honed my brewing process, focusing on grind consistency, water temperature, mineral composition, and CO₂ dissipation (the "bloom"), often with mixed results. I came to learn that no matter how much I refine my brew, it’s the beans themselves that truly define the cup. At its core, brewing coffee is simply dissolving flavor compounds in water – extracting the good, avoiding the bad. The key to brewing great coffee is sourcing and roasting beans such that they don't have any bad flavors to begin with. 

That may sound extreme, but trust me: great coffee can still taste great even if you brew it by boiling lake water and forgetting it for ten minutes while camping. (Not that I would know.)  

Like any agricultural product, the quality of the coffee crop is vital. The plant varietal, climate, altitude at which it’s grown, and the processing method all play major roles in defining the base quality. It’s up to the coffee roaster to make the coffee shine, and doing so is much easier said than done.

## Coffee Roasting Journey

I'm one of the weirdos who enjoyed the downtime of the pandemic. With work travel paused, I decided to get serious about roasting coffee. I’d dabbled in it before using a heat gun and an air popcorn popper, but now I was ready for something more serious. I started with a cheap $50 air roaster purchased on clearance. It did an okay job, but it was too slow to achieve modern specialty roast profiles. It was also quickly recalled for starting fires.

The recall paid out $80, and I used that cash to upgrade to a [Behmor 1600AB](https://behmor.com/) – a drum roaster inside a toaster oven. The seller, who was the R&D head at a Chicago commercial bakery, even threw in a book on the science of roasting. I was all in.

But while the Behmor was a step up, it still had limitations. Those limitations became especially clear after I did a deep dive on the science. I made some minor modifications to improve it, but ultimately the Behmor didn't cut it. I needed more heat capacity, better temperature control, and something I could hack more easily.

That led me to the [Fresh Roast SR800](https://www.sweetmarias.com/fresh-roast-sr800.html). It offered faster heat transfer, tighter temperature control, and most importantly, it was easily hackable. I drilled a hole through the top of it soon after it arrived and added a thermocouple to measure the bean temperature. That single change allowed me to collect real data and refine my roasting process. Oddly enough, that's really the only hardware difference between a $280 roaster and a $3,000 one: a $10 thermometer. 

## Next Steps

The other difference between a $280 roaster and a $3,000 one is automatic temperature control. That isn't particularly groundbreaking. PID control algorithms, designed for this purpose, have been used since the 1930s in countless industrial applications. And yet, they are completely ignored by designers of affordable coffee roasters. This is code that engineers could easily copy, paste, and tune – boosting the retail value of their machines tenfold – but they don't.

You know who can copy and paste that code? Me.

Because the other thing the SR800 offers is a rotary encoder knob to control it. That means that I can hack and control the roaster digitally using a microcontroller to emulate the output of the knob. With feedback from the thermocouple, I can write code to tightly control the temperature and fine-tune the charge phase, Maillard phase, sugar caramelization phase, roast development time, and ROR. And importantly, I can do this without ever touching the high-voltage circuits – achieving precision control without risking a house fire.

## Gallery

[Gallery]()

---
*License: [CC BY-SA 4.0 Deed](https://creativecommons.org/licenses/by-sa/4.0/) - You may copy, adapt, and use this work for any purpose, even commercial, but only if derivative works are distributed under the same license.*

*Category: Hardware, Software*