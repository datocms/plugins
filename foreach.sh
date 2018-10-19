#!/bin/bash

find . -type d -maxdepth 1 -mindepth 1 -not -path ./.git | while read d; do
  echo "=== $d ==="
  cd $d/
  "$@"
  cd ..
  echo
done
