#!/bin/bash

find . -type d -maxdepth 1 -mindepth 1 -not -path ./.git -not -path ./.github | while read d; do
  echo "=== $d ==="
  cd $d/
  "$@"
  cd ..
  echo
done
