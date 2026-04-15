const GameManager = require('./server/gameLogic');

async function test() {
  const gm = new GameManager();
  const room = gm.createRoom('host', 'Sujal', 5);
  // Add guest player
  gm.joinRoom('guest', 'GuestPlayer', room.code);
  
  // Set answers for this round
  room.answers = {
    'host': { name: 'Apple', place: 'asdfgh', animal: 'Lion', thing: 'Table' },
    'guest': { name: 'Apple', place: 'London', animal: 'Tiger', thing: 'Pencil' }
  };

  console.log('Testing validation...');
  try {
    const validationResults = await gm.validateAllAnswers(room.code);
    console.log('Validation Results:', validationResults);

    const scores = gm.calculateScores(room.code, validationResults);
    // console.log('Scores for Host:', JSON.stringify(scores.roundScores['host'].categories, null, 2));

    const hostPlace = scores.roundScores['host'].categories.place;
    const hostName = scores.roundScores['host'].categories.name;

    // Check if 'asdfgh' is invalid (points 0)
    if (hostPlace.points === 0 && hostPlace.valid === false) {
      console.log('✅ Success: Invalid word "asdfgh" scored 0.');
    } else {
      console.log('❌ Failure: Invalid word "asdfgh" should have scored 0. Got points:', hostPlace.points, 'valid:', hostPlace.valid);
    }

    // Check if 'Apple' is valid and shared (points 5)
    if (hostName.points === 5 && hostName.shared === true && hostName.valid === true) {
      console.log('✅ Success: Valid shared word "Apple" scored 5.');
    } else {
      console.log('❌ Failure: Valid shared word "Apple" should have scored 5. Got points:', hostName.points, 'shared:', hostName.shared);
    }

    // Check a valid unique word
    const guestPlace = scores.roundScores['guest'].categories.place;
    if (guestPlace.points === 10 && guestPlace.valid === true) {
      console.log('✅ Success: Valid unique word "London" scored 10.');
    } else {
      console.log('❌ Failure: Valid unique word "London" should have scored 10. Got points:', guestPlace.points);
    }

  } catch (err) {
    console.error('Test script crashed:', err);
  }
}

test();
