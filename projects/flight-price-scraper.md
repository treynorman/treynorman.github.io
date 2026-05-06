# Flight Price Scraper
*November 17, 2017*

## Overview

This scraper regularly searches for flights across a given time range and trip length. Notification emails are sent for flight prices below a given threshold. With every search, it forces a data refresh of flight prices before scraping them, ensuring that prices aren't stale. Multiple origin and destination airports are supported. Deals are saved to a CSV file.

## Video

[Video](https://www.youtube.com/embed/lLvh6TTTk4I)

## Details

For the last couple of years I've traveled almost exclusively using flight deals. Not the deals airlines advertise and send emails about, but the flash sales that pop up when airlines need to fill seats. I've also caught a couple of the [ever-elusive mistake fares](https://en.wikipedia.org/wiki/Mistake_fare) posted when an airline accidentally sets the wrong price. These deals have taken me from Texas to Hong Kong for $350 round trip and from Texas to Iceland for $180 round trip. They rarely last longer than a day or two – sometimes less than four hours.

A number of "flight hackers" run services to alert their subscribers when sales like this appear. Their marketing leads people to believe that they run sophisticated algorithms to catch every deal. That's not the case. I recently learned that the most well-known "flight hacker" pays people at a click farm to sit around looking for deals all day. But how hard is it to actually automate the process?

I needed a cheap flight to Africa and decided to automate the deal search myself.

I quickly learned that using an API to check flight prices would be impossible. The travel industry's pricing and ticketing process is convoluted, but the bottom line is that access to a price API can **cost up to $30,000 per month**. Having spent my last $30,000 on something more useful than a month of API access, web scraping was the only way to go. I settled on Google Flights as the best site to scrape. It's easy to see how flight searches are encoded in Google Flights URL's and automatically generate them in Python. But simply loading the static search results page into a web scraper like BeautifulSoup4 isn't enough to get the prices. Flight prices load slowly as price data is gathered and populated on the page with JavaScript. It can take up to 10 seconds for the page to finish loading.

Seleium is a tool that remotely controls a web browser. It works just like a human opening a web page and clicking around, but it can be controlled programmatically. Using the Selenium web driver for Python, we can wait for flight prices to load, store Google's "best" price in a CSV file, and send an email when the price drops below a certain threshold. Why not use prices in the "calendar of fares" to reduce the number of searches? Unfortunately that price data is stale. It's cached when somebody performs a search and only updated when the search is performed again. My application is designed to run 24/7 searching a range of dates with different trip lengths. It searches multiple routes and clear cookies between each search.

Below is the source code and other resources needed to run the Python app. I've also included a README file describing how to set up and configure the scraper for different searches.

**Update (May 2019)**: The Google Flights URL scheme and website layout have changed. I've modified my code to accommodate the changes.  
**Update (December 2020)**: Google Flights URLs have been obfuscated. This isn't impossible to overcome, but for now this project is deprecated.

## Gallery

[Gallery]()

## Download

[Download](flight-price-scraper/FlightPriceScraper_v0.2.zip)

---
*License: [CC BY-SA 4.0 Deed](https://creativecommons.org/licenses/by-sa/4.0/) - You may copy, adapt, and use this work for any purpose, even commercial, but only if derivative works are distributed under the same license.*

*Category: Software*