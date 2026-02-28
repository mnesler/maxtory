#!/usr/bin/env python3
"""
Generate four random integers between 0 and 9999 using the secrets module.
"""

import secrets

# Generate four random integers between 0 and 9999
random_int1 = secrets.randbelow(10000)
random_int2 = secrets.randbelow(10000)
random_int3 = secrets.randbelow(10000)
random_int4 = secrets.randbelow(10000)

# Print the four integers to console in a single line separated by spaces
print(f"{random_int1} {random_int2} {random_int3} {random_int4}")

# Save as comma-separated list in output.txt
with open('output.txt', 'w') as f:
    f.write(f"{random_int1},{random_int2},{random_int3},{random_int4}")