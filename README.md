# trey.zip

This repo includes a custom-built static site generator for my personal site as well as the site itself.

`utils/generate_site.py` generates of the full website and project pages from articles written in markdown. The `projects` directory contains all article markdown files. Gallery images are located alongside project articles inside sub-directories that correspond to the article filename. `utils/web-optimize-images.sh` resizes and compresses gallery images for faster page loads and also contains a function to optimize thumbnail images for use on the homepage.