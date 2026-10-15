# Fractal-dimension experiment (3×3×2 grid, 2 biomes)

Fractal-dimension sweep: 3 fractal types × 3 escape-time resolutions × 2 zooms × 2 biomes (= 36 runs). Same habitat within a biome; only the fractal regime differs.

| biome | fractal | maxIter | zoom | class | alive | dPop | species | births | fitness | ATP | O2 | pH | toxin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| calm | mandelbrot | 32 | 2 | control | 32 | -8 | 19 | 0 | 0.514 | 0.215 | 0.951 | 7.00 | 0.001 |
| calm | mandelbrot | 32 | 4 | control | 31 | -9 | 21 | 1 | 0.523 | 0.221 | 0.928 | 7.00 | 0.000 |
| calm | mandelbrot | 256 | 2 | control | 31 | -9 | 17 | 0 | 0.516 | 0.226 | 0.951 | 7.00 | 0.001 |
| calm | mandelbrot | 256 | 4 | control | 31 | -9 | 24 | 0 | 0.528 | 0.221 | 0.928 | 7.00 | 0.000 |
| calm | mandelbrot | 1024 | 2 | control | 34 | -6 | 18 | 0 | 0.507 | 0.221 | 0.951 | 7.00 | 0.001 |
| calm | mandelbrot | 1024 | 4 | control | 31 | -9 | 20 | 0 | 0.523 | 0.220 | 0.928 | 7.00 | 0.000 |
| calm | julia | 32 | 2 | control | 34 | -6 | 20 | 0 | 0.532 | 0.229 | 0.938 | 7.00 | 0.000 |
| calm | julia | 32 | 4 | control | 45 | +5 | 21 | 0 | 0.515 | 0.189 | 0.930 | 7.00 | 0.000 |
| calm | julia | 256 | 2 | control | 26 | -14 | 15 | 0 | 0.507 | 0.231 | 0.938 | 7.00 | 0.001 |
| calm | julia | 256 | 4 | control | 39 | -1 | 19 | 0 | 0.520 | 0.195 | 0.929 | 7.00 | 0.000 |
| calm | julia | 1024 | 2 | control | 28 | -12 | 17 | 1 | 0.515 | 0.241 | 0.938 | 7.00 | 0.000 |
| calm | julia | 1024 | 4 | control | 37 | -3 | 16 | 0 | 0.518 | 0.197 | 0.929 | 7.00 | 0.000 |
| calm | perlin | 32 | 2 | control | 30 | -10 | 19 | 0 | 0.520 | 0.235 | 0.975 | 7.00 | 0.000 |
| calm | perlin | 32 | 4 | control | 26 | -14 | 16 | 0 | 0.508 | 0.246 | 0.978 | 7.00 | 0.000 |
| calm | perlin | 256 | 2 | control | 31 | -9 | 18 | 0 | 0.508 | 0.240 | 0.978 | 7.00 | 0.000 |
| calm | perlin | 256 | 4 | control | 25 | -15 | 17 | 0 | 0.508 | 0.251 | 0.978 | 7.00 | 0.000 |
| calm | perlin | 1024 | 2 | control | 26 | -14 | 17 | 0 | 0.531 | 0.254 | 0.978 | 7.00 | 0.000 |
| calm | perlin | 1024 | 4 | control | 25 | -15 | 16 | 0 | 0.519 | 0.250 | 0.978 | 7.00 | 0.000 |
| hyperthermal | mandelbrot | 32 | 2 | extreme | 20 | -20 | 14 | 0 | 0.479 | 0.187 | 0.858 | 4.50 | 0.500 |
| hyperthermal | mandelbrot | 32 | 4 | extreme | 36 | -4 | 17 | 0 | 0.514 | 0.207 | 0.910 | 4.50 | 0.500 |
| hyperthermal | mandelbrot | 256 | 2 | extreme | 20 | -20 | 14 | 0 | 0.475 | 0.187 | 0.858 | 4.50 | 0.500 |
| hyperthermal | mandelbrot | 256 | 4 | extreme | 34 | -6 | 16 | 1 | 0.521 | 0.208 | 0.909 | 4.50 | 0.500 |
| hyperthermal | mandelbrot | 1024 | 2 | extreme | 20 | -20 | 14 | 0 | 0.474 | 0.187 | 0.858 | 4.50 | 0.500 |
| hyperthermal | mandelbrot | 1024 | 4 | extreme | 33 | -7 | 16 | 0 | 0.532 | 0.209 | 0.909 | 4.50 | 0.500 |
| hyperthermal | julia | 32 | 2 | extreme | 26 | -14 | 16 | 1 | 0.503 | 0.189 | 0.938 | 4.50 | 0.501 |
| hyperthermal | julia | 32 | 4 | extreme | 34 | -6 | 17 | 0 | 0.516 | 0.218 | 0.903 | 4.50 | 0.500 |
| hyperthermal | julia | 256 | 2 | extreme | 26 | -14 | 13 | 0 | 0.511 | 0.194 | 0.937 | 4.50 | 0.500 |
| hyperthermal | julia | 256 | 4 | extreme | 33 | -7 | 16 | 0 | 0.517 | 0.221 | 0.902 | 4.50 | 0.500 |
| hyperthermal | julia | 1024 | 2 | extreme | 27 | -13 | 15 | 0 | 0.503 | 0.192 | 0.936 | 4.50 | 0.500 |
| hyperthermal | julia | 1024 | 4 | extreme | 34 | -6 | 16 | 0 | 0.512 | 0.219 | 0.902 | 4.50 | 0.500 |
| hyperthermal | perlin | 32 | 2 | extreme | 31 | -9 | 16 | 0 | 0.510 | 0.196 | 0.969 | 4.50 | 0.500 |
| hyperthermal | perlin | 32 | 4 | extreme | 32 | -8 | 18 | 0 | 0.509 | 0.204 | 0.971 | 4.50 | 0.500 |
| hyperthermal | perlin | 256 | 2 | extreme | 31 | -9 | 18 | 0 | 0.502 | 0.212 | 0.972 | 4.50 | 0.500 |
| hyperthermal | perlin | 256 | 4 | extreme | 25 | -15 | 18 | 0 | 0.510 | 0.217 | 0.972 | 4.50 | 0.500 |
| hyperthermal | perlin | 1024 | 2 | extreme | 37 | -3 | 23 | 0 | 0.513 | 0.200 | 0.971 | 4.50 | 0.500 |
| hyperthermal | perlin | 1024 | 4 | extreme | 32 | -8 | 17 | 0 | 0.515 | 0.203 | 0.972 | 4.50 | 0.501 |
