'use strict';

/**
 * Local fallback dataset for Name validation.
 * ~1000 common first names (global + Indian subcontinent).
 * All lowercase for easy comparison.
 */
const NAMES = new Set([
  // A
  'aaron','abby','abel','abigail','abraham','adam','aditi','adnan','adrian','advait',
  'aditya','afreen','agatha','agnes','ahmad','ahmed','aiden','aisha','ajay','akash',
  'akira','alan','albert','alex','alexa','alexander','alexis','alfie','ali','alice',
  'alicia','alina','alisha','alison','aliya','allah','allen','alok','alona','alvin',
  'alyssa','amanda','amber','amelia','amos','amy','ana','ananya','andrea','andrew',
  'andy','angel','angela','anika','anita','anjali','anna','anne','anthony','anuj',
  'anupama','anushka','anya','april','arjun','arpit','aryan','ash','ashley','ashok',
  'ashwin','asif','atharv','austin','ava','avery','ayaan','ayesha','ayush',
  // B
  'babita','bailey','barbara','bella','ben','benjamin','bertha','beth','betty','bhavna',
  'billy','bipasha','bob','bobby','bonnie','brad','brady','brandon','brent','brett',
  'brian','bridget','brittany','brooke','bryan','bunty',
  // C
  'caleb','cameron','candice','carl','carlos','caroline','casey','catherine','chad',
  'chandler','chandra','charles','charlie','charlotte','chetan','chloe','chris',
  'christian','christina','christopher','cindy','claire','clara','clark','clay',
  'colton','connie','corey','courtney','craig','crystal','cynthia',
  // D
  'daisy','dale','dan','daniel','danielle','darren','david','dawn','dean','deborah',
  'deepak','deepika','delilah','dennis','derek','diana','diego','divya','dominic',
  'donald','donna','doris','dorothy','douglas','drew','dylan',
  // E
  'edgar','edith','edward','elena','eli','elijah','elizabeth','ella','ellie','emily',
  'emma','eric','erica','erin','ethan','eva','evan','evelyn',
  // F
  'faith','faizan','farhan','fatima','felix','fiona','frank','fred','freddie',
  // G
  'gabriel','gauri','gaurav','george','georgia','gia','gina','girish','gloria',
  'grace','graham','grant','greg','greta','gurpreet',
  // H
  'hannah','harry','harsh','harsha','hazel','heather','helen','henry','holly',
  'hira','hunter',
  // I
  'ian','ibrahim','isha','ishaan','ishita','ivan',
  // J
  'jack','jackson','jacob','james','jamie','jane','jason','jasmine','jay','jaya',
  'jayesh','jeff','jennifer','jenny','jessica','joel','john','johnny','jonathan',
  'jordan','joseph','joshua','judy','julia','julian','julie','justin',
  // K
  'karan','karen','kate','katherine','katie','kavya','kayla','keanu','kelly','kevin',
  'kiran','komal','krishna','kriti','kumar','kyle',
  // L
  'lara','larry','laura','lauren','layla','leah','leo','liam','lily','linda','lisa',
  'logan','louis','lucy','luke','luna',
  // M
  'madhuri','mahesh','manish','mansi','mark','martha','mary','mason','matthew','max',
  'maya','meera','meghan','melissa','michael','michelle','mike','milan','mohit',
  'monica','morgan','mukesh',
  // N
  'natalie','nathan','neil','neha','nicholas','nick','nikita','nisha','noah','nora',
  'nour',
  // O
  'olivia','omar','oscar',
  // P
  'pamela','patricia','patrick','paul','paula','peter','philip','phoebe','pooja',
  'pradeep','priya','priyanka',
  // Q
  'quinn',
  // R
  'rachel','rahul','raj','rajesh','rajan','rakesh','ramesh','raymond','ravi','rebecca',
  'reena','richard','rick','rita','rob','robert','robin','rohan','rohit','ross',
  'ruby','ryan',
  // S
  'sahil','sam','samuel','sangita','sarah','sanjay','sara','scott','sean','shreya',
  'shubham','simran','sneha','sonam','sophia','sophie','stephen','steve','steven',
  'steven','sunita','suraj','suresh','susan','swati',
  // T
  'taylor','thomas','tiffany','tim','timothy','tom','tyler',
  // U
  'uday','ujjwal','uma','usha',
  // V
  'vanessa','varun','vijay','vikram','virat','vishal','vivek',
  // W
  'walter','wendy','william',
  // X
  'xavier','xena',
  // Y
  'yash','yasmin','yogesh','yusuf',
  // Z
  'zara','zoe','zoya','zubin',
]);

module.exports = NAMES;
