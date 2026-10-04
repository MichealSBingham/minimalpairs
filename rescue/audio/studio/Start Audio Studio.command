#!/bin/zsh
cd "${0:A:h}"
PYTHON="../.venv/bin/python"
"$PYTHON" studio.py init || exit 1
while true; do
  print '\nMinimalPairs — local Chatterbox studio'
  print '1. Test four recordings (two words × two voices)'
  print '2. Generate the 16-word English audition (32 recordings)'
  print '3. Generate all American English (250 words × four voices)'
  print '4. Open the listening and word review page'
  print '5. Exit'
  print '6. Cartesia comparison: two words × four voices'
  print '7. Cartesia 16-word audition: four voices'
  read 'choice?Choose 1–7: '
  case "$choice" in
    1) "$PYTHON" studio.py generate --provider chatterbox --limit 2 --execute ;;
    2) "$PYTHON" studio.py generate --provider chatterbox --execute ;;
    3) print 'This generates 1,000 local recordings, marked unreviewed. Completed recordings are reused.'
       read 'confirmation?Type GENERATE to start: '
       [[ "$confirmation" == GENERATE ]] && "$PYTHON" studio.py generate --provider chatterbox --voices 4 --all-words --execute ;;
    4) (sleep 2; open 'http://127.0.0.1:63119') &
       "$PYTHON" studio.py serve ;;
    5) exit 0 ;;
    6) "$PYTHON" studio.py generate --provider cartesia --limit 2 --voices 4 --execute ;;
    7) "$PYTHON" studio.py generate --provider cartesia --voices 4 --execute ;;
  esac
done
