# Raw data (not published)

Place `Hospital_ER_Data.csv` (supplied with the project brief) here to rebuild the processed files with `python scripts/prepare_data.py`.

The raw file contains patient names and SSN-style identifiers. They appear to be fictional, but the file is excluded from the repository by `.gitignore` as a privacy precaution. The dashboard uses only the de-identified copy in `data/er_visits_deidentified.csv` and `data/base-data.js`.
