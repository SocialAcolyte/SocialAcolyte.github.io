# Credits: raking-light

The code written for this piece is MIT licensed (see LICENSE). The images,
sounds and third-party code it uses keep their own licences, listed here.

## Images and media

- **Cuneiform tablet: student exercise tablet**, ca. 20th–16th century BCE. Source: The Metropolitan Museum of Art, object 321878, accession 86.11.251. <https://www.metmuseum.org/art/collection/search/321878>  
  Licence: CC0 (The Metropolitan Museum of Art, Open Access).  
  Changes: Cut out from its grey backdrop (colour threshold seeding GrabCut, outline smoothed, anti-aliased alpha pulled in 2 px), resized to 956 px. Albedo and normal/height maps derived from this photo (see README).  
  File: `assets/round-tablet.webp`
- **Cuneiform tablet: commentary on Enuma Anu Enlil, tablet 5**, ca. late 1st millennium BCE. Source: The Metropolitan Museum of Art, object 321874, accession 86.11.503. <https://www.metmuseum.org/art/collection/search/321874>  
  Licence: CC0 (The Metropolitan Museum of Art, Open Access).  
  Changes: Cut out as above, resized to 1150 px. Albedo and normal/height maps derived from this photo.  
  File: `assets/omen-fragment.webp`
- **Relief panel (Ashurnasirpal II with attendants and a winged genie; Standard Inscription)**, ca. 883–859 BCE. Source: The Metropolitan Museum of Art, photograph DP-346-001, donated to Wikimedia Commons by the Met. <https://commons.wikimedia.org/wiki/File:Relief_panel_MET_DP-346-001-JPG_Original_300dpi.jpg>  
  Licence: CC0 (The Metropolitan Museum of Art, Open Access).  
  Changes: Fetched at 3840 px via tools/fetch_commons.py (library/ornaments/reliefs/). Cropped to a band (frame and lower ledge removed), resized to 2400 px. Albedo and normal/height maps derived from this photo.  
  File: `assets/nimrud-relief.webp`

## From the README

- Photographs: The Metropolitan Museum of Art, Open Access (CC0): a student
  exercise tablet (Old Babylonian, 321878), a commentary on *Enuma Anu Enlil*
  (321874), and a relief panel from the Northwest Palace of Ashurnasirpal II at
  Nimrud (photograph DP-346-001, via the Met's Wikimedia Commons donation).
  Details in `assets/credits.json`.
- Depth: Depth Anything V2 Small (Yang et al., 2024; Apache-2.0), run offline;
  nothing of it ships.
- After the practice of raking-light photography and reflectance
  transformation imaging (Malzbender et al., HP Labs, 2001; Cultural Heritage
  Imaging). No third-party code in the component.
