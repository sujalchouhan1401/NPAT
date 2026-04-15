'use strict';

/**
 * Local fallback dataset for Place validation.
 * Covers countries, major world cities, Indian states & cities.
 * All lowercase for easy comparison.
 */
const PLACES = new Set([
  // Countries – A
  'afghanistan','albania','algeria','angola','argentina','armenia','australia',
  'austria','azerbaijan',
  // Countries – B
  'bahrain','bangladesh','belarus','belgium','bhutan','bolivia','brazil','brunei',
  'bulgaria','burkina','burundi',
  // Countries – C
  'cambodia','cameroon','canada','chile','china','colombia','croatia','cuba','cyprus',
  // Countries – D
  'denmark','djibouti','dominica',
  // Countries – E
  'ecuador','egypt','eritrea','estonia','ethiopia',
  // Countries – F
  'fiji','finland','france',
  // Countries – G
  'gabon','georgia','germany','ghana','greece','guatemala','guinea',
  // Countries – H
  'haiti','honduras','hungary',
  // Countries – I
  'iceland','india','indonesia','iran','iraq','ireland','israel','italy',
  // Countries – J
  'jamaica','japan','jordan',
  // Countries – K
  'kazakhstan','kenya','kuwait','kyrgyzstan',
  // Countries – L
  'laos','latvia','lebanon','libya','liechtenstein','lithuania','luxembourg',
  // Countries – M
  'madagascar','malawi','malaysia','maldives','mali','malta','mauritius','mexico',
  'moldova','monaco','mongolia','morocco','mozambique','myanmar',
  // Countries – N
  'namibia','nepal','netherlands','nicaragua','nigeria','norway',
  // Countries – O
  'oman',
  // Countries – P
  'pakistan','palestine','panama','peru','philippines','poland','portugal',
  // Countries – Q
  'qatar',
  // Countries – R
  'romania','russia','rwanda',
  // Countries – S
  'saudi','senegal','serbia','singapore','slovakia','slovenia','somalia','spain',
  'srilanka','sudan','sweden','switzerland','syria',
  // Countries – T
  'taiwan','tajikistan','tanzania','thailand','togo','trinidad','tunisia','turkey',
  'turkmenistan',
  // Countries – U
  'uganda','ukraine','uae','uruguay','uzbekistan',
  // Countries – V
  'venezuela','vietnam',
  // Countries – Y/Z
  'yemen','zambia','zimbabwe',

  // Major World Cities – A
  'amsterdam','ankara','athens','atlanta','auckland','austin',
  // B
  'baghdad','baku','baltimore','bangkok','barcelona','beijing','beirut','belgrade',
  'berlin','bogota','boston','brussels','bucharest','budapest','buenos',
  // C
  'cairo','calgary','cape','casablanca','chicago','copenhagen',
  // D
  'dallas','damascus','delhi','denver','dhaka','doha','dubai','dublin',
  // E
  'edinburgh',
  // F
  'frankfurt',
  // G
  'geneva','guangzhou',
  // H
  'hamburg','hanoi','havana','helsinki','hongkong','houston',
  // I
  'istanbul',
  // J
  'jakarta','johannesburg',
  // K
  'kabul','karachi','kathmandu','khartoum','kinshasa','kuala','kyoto',
  // L
  'lagos','lahore','lima','lisbon','london','losangeles','luxembourg',
  // M
  'madrid','manila','melbourne','miami','milan','minsk','montreal','moscow',
  'mumbai','munich',
  // N
  'nairobi','nagoya','naples','nashville','newdelhi','newyork','oslo',
  // O
  'orlando','osaka',
  // P
  'paris','prague','pretoria',
  // R
  'riyadh','rome',
  // S
  'santiago','seattle','seoul','shanghai','singapore','stockholm','sydney',
  // T
  'tehran','tokyo','toronto',
  // V
  'vancouver','vienna',
  // W
  'warsaw','washington',
  // Z
  'zurich',

  // Indian States
  'andhra','arunachal','assam','bihar','chhattisgarh','goa','gujarat','haryana',
  'himachal','jharkhand','karnataka','kerala','madhya','maharashtra','manipur',
  'meghalaya','mizoram','nagaland','odisha','punjab','rajasthan','sikkim',
  'tamilnadu','telangana','tripura','uttar','uttarakhand','westbengal',

  // Indian Cities
  'agra','ahmedabad','ajmer','allahabad','amritsar','aurangabad','bengaluru',
  'bhopal','bhubaneswar','chandigarh','chennai','coimbatore','dehradun',
  'faridabad','guwahati','gwalior','hyderabad','indore','jaipur','jammu',
  'jodhpur','kanpur','kochi','kolkata','kozhikode','lucknow','ludhiana',
  'madurai','meerut','mysore','nagpur','nashik','noida','patna','pune',
  'raipur','ranchi','srinagar','surat','thiruvananthapuram','vadodara',
  'varanasi','vijayawada','visakhapatnam',
]);

module.exports = PLACES;
