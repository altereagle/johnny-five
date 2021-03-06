/*

  This is a port by Rebecca Murphey of the LedControl library.
  The license of the original library is as follows:

  LedControl.cpp - A library for controling Leds with a MAX7219/MAX7221
  Copyright (c) 2007 Eberhard Fahle

  Permission is hereby granted, free of charge, to any person
  obtaining a copy of this software and associated documentation
  files (the "Software"), to deal in the Software without
  restriction, including without limitation the rights to use,
  copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the
  Software is furnished to do so, subject to the following
  conditions:

  This permission notice shall be included in all copies or
  substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
  OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
  NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
  HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
  WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
  FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
  OTHER DEALINGS IN THE SOFTWARE.

 */

var Board = require("../lib/board.js"),
    es6 = require("es6-collections"),
    WeakMap = es6.WeakMap;

// Led instance private data
var priv = new WeakMap();

function LedControl( opts ) {
  var i, j;

  opts = Board.options( opts );

  this.board = Board.mount( opts );
  this.firmata = this.board.firmata;

  this.pins = {
    data: opts.pins.data,
    clock: opts.pins.clock,
    cs: opts.pins.cs || opts.pins.latch
  };

  this.status = [];

  for ( i = 0; i < 64; i++ ) {
    this.status[ i ] = 0x00;
  }


  [ "data", "clock", "cs" ].forEach(function( pin ) {
    this.firmata.pinMode( this.pins[ pin ], this.firmata.MODES.OUTPUT );
  }, this);

  this.board.digitalWrite( this.pins.cs, this.firmata.HIGH );

  for ( j = 0; j < opts.devices; j++ ) {
    this.send( j, LedControl.OP.DISPLAYTEST, 0 );
    this.setScanLimit( j, 7 );
    this.send( j, LedControl.OP.DECODEMODE, 0 );
    this.clear( j );
    this.shutdown( j , true );
  }

  priv.set( this, {
    devices: opts.devices,
    isMatrix: !!opts.isMatrix
  });

  Object.defineProperties( this, {
    devices: {
      get: function() {
        return priv.get( this ).devices;
      }
    },

    isMatrix : {
      get: function() {
        return priv.get( this ).isMatrix;
      }
    }
  });
}


LedControl.prototype.on = function( addr ) {
  return this.shutdown( addr, false );
};

LedControl.prototype.off = function( addr ) {
  return this.shutdown( addr, true );
};

LedControl.prototype.shutdown = function( addr, status ) {
  // shuts off if status == true
  if ( addr < this.devices ) {
    this.send(
      addr, LedControl.OP.SHUTDOWN, status ? 0 : 1
    );
  }
  return this;
};

LedControl.prototype.setScanLimit = function( addr, limit ) {
  if ( addr < this.devices ) {
    this.send(
      addr, LedControl.OP.SCANLIMIT, limit
    );
  }
  return this;
};

LedControl.prototype.brightness = function( addr, val ) {
  if ( addr < this.devices ) {
    this.send(
      addr, LedControl.OP.INTENSITY, val
    );
  }
  return this;
};

LedControl.prototype.clear = function( addr ) {
  var i, offset;

  offset =  addr * 8;

  for ( i = 0; i < 8; i++ ) {
    this.status[ offset + i ] = 0;
    this.send( addr, i + 1, 0 );
  }
};

LedControl.prototype.led = function( addr, row, col, state ) {
  var offset, val;

  if ( addr < this.devices ) {
    offset = addr * 8;
    val = 0x80 >> col;

    if ( state ) {
      this.status[ offset + row ] = this.status[ offset + row ] | val;
    } else {
      val = ~val;
      this.status[ offset + row ] = this.status[ offset + row ] & val;
    }
    this.send( addr, row + 1, this.status[ offset + row ] );
  }
  return this;
};

LedControl.prototype.row = function( addr, row, val /* 0 - 255 */ ) {
  var offset = addr * 8;

  if ( addr < this.devices ) {
    this.status[ offset + row ] = val;
    this.send( addr, row + 1, this.status[ offset + row ] );
  }
  return this;
};

LedControl.prototype.column = function( addr, col, val /* 0 - 255 */ ) {
  var row;

  if ( addr < this.devices ) {
    for ( row = 0; row < 8; row++ ) {
      val = val >> ( 7 - row );
      val = val & 0x01;
      this.led( addr, row, col, val );
    }
  }
  return this;
};

LedControl.prototype.digit = function( addr, digit, val, dp ) {
  var offset, v;

  if ( addr < this.devices ) {
    offset = addr * 8;

    v = LedControl.CHAR_TABLE[ val > 127 ? 32 : val ];

    if ( dp ) {
      v = v | 0x80;
    }

    this.status[ offset + digit ] = v;
    this.send( addr, digit + 1, v );
  }
  return this;
};

LedControl.prototype.char = function( addr, digit, val, dp ) {
  // in matrix mode, this takes two arguments:
  // addr and the character to display
  var character;

  if ( this.isMatrix ) {
    character = digit;

    LedControl.MATRIX_CHARS[ character ].forEach(function( rowByte, idx ) {
      process.nextTick(function() {
        this.row( addr, idx, rowByte );
      }.bind(this));
    }, this);
  } else {

    // in seven-segment mode, this takes four arguments, which
    // are just passed through to digit
    this.digit( addr, digit, val, dp );
  }
  return this;
};


// TODO:
// Implement smart "print" function that parses and prints
// using the existing api (consolidates function calls)
LedControl.prototype.print = function() {

};


LedControl.prototype.send = function( addr, opcode, data ) {
  var offset, maxBytes, spiData, i, j;

  offset = addr * 2;
  maxBytes = this.devices * 2;
  spiData = [];

  for ( i = 0; i < maxBytes; i++ ) {
    spiData[ i ] = 0;
  }

  spiData[ offset + 1 ] = opcode;
  spiData[ offset ] = data;

  this.board.digitalWrite( this.pins.cs, this.firmata.LOW );

  for ( j = maxBytes; j > 0; j-- ) {
    this.board.shiftOut( this.pins.data, this.pins.clock, spiData[ j - 1 ] );
  }

  this.board.digitalWrite( this.pins.cs, this.firmata.HIGH );

  return this;
};

LedControl.OP = {};

LedControl.OP.NOOP =        0x00;

LedControl.OP.DIGIT0 =      0x01;
LedControl.OP.DIGIT1 =      0x02;
LedControl.OP.DIGIT2 =      0x03;
LedControl.OP.DIGIT3 =      0x04;
LedControl.OP.DIGIT4 =      0x05;
LedControl.OP.DIGIT5 =      0x06;
LedControl.OP.DIGIT6 =      0x07;
LedControl.OP.DIGIT7 =      0x08;

LedControl.OP.DECODEMODE =  0x09;
LedControl.OP.INTENSITY =   0x0a;
LedControl.OP.SCANLIMIT =   0x0b;
LedControl.OP.SHUTDOWN =    0x0c;
LedControl.OP.DISPLAYTEST = 0x0f;

LedControl.CHAR_TABLE = [
  "01111110", // 0
  "00110000", // 1
  "01101101", // 2
  "01111001", // 3
  "00110011", // 4
  "01011011", // 5
  "01011111", // 6
  "01110000", // 7
  "01111111", // 8
  "01111011", // 9
  "01110111", // a
  "00011111", // b
  "00001101", // c
  "00111101", // d
  "01001111", // e
  "01000111", // f
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "10000000",
  "00000001",
  "10000000",
  "00000000",
  "01111110",
  "00110000",
  "01101101",
  "01111001",
  "00110011",
  "01011011",
  "01011111",
  "01110000",
  "01111111",
  "01111011",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "01110111",
  "00011111",
  "00001101",
  "00111101",
  "01001111",
  "01000111",
  "00000000",
  "00110111",
  "00000000",
  "00000000",
  "00000000",
  "00001110",
  "00000000",
  "00000000",
  "00000000",
  "01100111",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00001000",
  "00000000",
  "01110111",
  "00011111",
  "00001101",
  "00111101",
  "01001111",
  "01000111",
  "00000000",
  "00110111",
  "00000000",
  "00000000",
  "00000000",
  "00001110",
  "00000000",
  "00000000",
  "00000000",
  "01100111",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000",
  "00000000"
].map(function( str ) {
  return parseInt( str, 2 );
});

LedControl.MATRIX_CHARS = {
  "!" : [ 0x04, 0x04, 0x04, 0x04, 0x00, 0x00, 0x04, 0x00 ],
  '"' : [ 0x0A, 0x0A, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00 ],
  "#" : [ 0x0A, 0x0A, 0x1F, 0x0A, 0x1F, 0x0A, 0x0A, 0x00 ],
  "$" : [ 0x04, 0x0F, 0x14, 0x0E, 0x05, 0x1E, 0x04, 0x00 ],
  "%" : [ 0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03, 0x00 ],
  "&" : [ 0x0C, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0D, 0x00 ],
  "'" : [ 0x0C, 0x04, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00 ],
  "(" : [ 0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02, 0x00 ],
  ")" : [ 0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08, 0x00 ],
  "*" : [ 0x00, 0x04, 0x15, 0x0E, 0x15, 0x04, 0x00, 0x00 ],
  "+" : [ 0x00, 0x04, 0x04, 0x1F, 0x04, 0x04, 0x00, 0x00 ],
  "," : [ 0x00, 0x00, 0x00, 0x00, 0x0C, 0x04, 0x08, 0x00 ],
  "-" : [ 0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00, 0x00 ],
  "." : [ 0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C, 0x00 ],
  "/" : [ 0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x00, 0x00 ],
  "0" : [ 0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E, 0x00 ],
  "1" : [ 0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E, 0x00 ],
  "2" : [ 0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F, 0x00 ],
  "3" : [ 0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E, 0x00 ],
  "4" : [ 0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02, 0x00 ],
  "5" : [ 0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E, 0x00 ],
  "6" : [ 0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E, 0x00 ],
  "7" : [ 0x1F, 0x01, 0x02, 0x04, 0x04, 0x04, 0x04, 0x00 ],
  "8" : [ 0x1E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E, 0x00 ],
  "9" : [ 0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C, 0x00 ],
  ":" : [ 0x00, 0x0C, 0x0C, 0x00, 0x0C, 0x0C, 0x00, 0x00 ],
  ";" : [ 0x00, 0x0C, 0x0C, 0x00, 0x0C, 0x04, 0x08, 0x00 ],
  "<" : [ 0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02, 0x00 ],
  "=" : [ 0x00, 0x00, 0x1F, 0x00, 0x1F, 0x00, 0x00, 0x00 ],
  ">" : [ 0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08, 0x00 ],
  "?" : [ 0x0E, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04, 0x00 ],
  "@" : [ 0x0E, 0x11, 0x01, 0x0D, 0x15, 0x15, 0x0E, 0x00 ],
  "A" : [ 0x0E, 0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x00 ],
  "B" : [ 0x1E, 0x09, 0x09, 0x0E, 0x09, 0x09, 0x1E, 0x00 ],
  "C" : [ 0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E, 0x00 ],
  "D" : [ 0x1E, 0x09, 0x09, 0x09, 0x09, 0x09, 0x1E, 0x00 ],
  "E" : [ 0x1F, 0x10, 0x10, 0x1F, 0x10, 0x10, 0x1F, 0x00 ],
  "F" : [ 0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10, 0x00 ],
  "G" : [ 0x0E, 0x11, 0x10, 0x13, 0x11, 0x11, 0x0F, 0x00 ],
  "H" : [ 0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11, 0x00 ],
  "I" : [ 0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E, 0x00 ],
  "J" : [ 0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C, 0x00 ],
  "K" : [ 0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11, 0x00 ],
  "L" : [ 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F, 0x00 ],
  "M" : [ 0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11, 0x00 ],
  "N" : [ 0x11, 0x19, 0x19, 0x15, 0x13, 0x13, 0x11, 0x00 ],
  "O" : [ 0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E, 0x00 ],
  "P" : [ 0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10, 0x00 ],
  "Q" : [ 0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x1D, 0x00 ],
  "R" : [ 0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11, 0x00 ],
  "S" : [ 0x0E, 0x11, 0x10, 0x0E, 0x01, 0x11, 0x0E, 0x00 ],
  "T" : [ 0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x00 ],
  "U" : [ 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E, 0x00 ],
  "V" : [ 0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04, 0x00 ],
  "W" : [ 0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11, 0x00 ],
  "X" : [ 0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11, 0x00 ],
  "Y" : [ 0x11, 0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x00 ],
  "Z" : [ 0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F, 0x00 ],
  "[" : [ 0x0E, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0E, 0x00 ],
  "\\": [ 0x00, 0x10, 0x08, 0x04, 0x02, 0x01, 0x00, 0x00 ],
  "]" : [ 0x0E, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0E, 0x00 ],
  "^" : [ 0x04, 0x0A, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00 ],
  "_" : [ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F, 0x00 ],
  "`" : [ 0x10, 0x08, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00 ],
  "a" : [ 0x00, 0x00, 0x0E, 0x01, 0x0F, 0x11, 0x0F, 0x00 ],
  "b" : [ 0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x1E, 0x00 ],
  "c" : [ 0x00, 0x00, 0x0E, 0x11, 0x10, 0x11, 0x0E, 0x00 ],
  "d" : [ 0x01, 0x01, 0x0D, 0x13, 0x11, 0x11, 0x0F, 0x00 ],
  "e" : [ 0x00, 0x00, 0x0E, 0x11, 0x1F, 0x10, 0x0E, 0x00 ],
  "f" : [ 0x02, 0x05, 0x04, 0x0E, 0x04, 0x04, 0x04, 0x00 ],
  "g" : [ 0x00, 0x0D, 0x13, 0x13, 0x0D, 0x01, 0x0E, 0x00 ],
  "h" : [ 0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x11, 0x00 ],
  "i" : [ 0x04, 0x00, 0x0C, 0x04, 0x04, 0x04, 0x0E, 0x00 ],
  "j" : [ 0x02, 0x00, 0x06, 0x02, 0x02, 0x12, 0x0C, 0x00 ],
  "k" : [ 0x08, 0x08, 0x09, 0x0A, 0x0C, 0x0A, 0x09, 0x00 ],
  "l" : [ 0x0C, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E, 0x00 ],
  "m" : [ 0x00, 0x00, 0x1A, 0x15, 0x15, 0x15, 0x15, 0x00 ],
  "n" : [ 0x00, 0x00, 0x16, 0x19, 0x11, 0x11, 0x11, 0x00 ],
  "o" : [ 0x00, 0x00, 0x0E, 0x11, 0x11, 0x11, 0x0E, 0x00 ],
  "p" : [ 0x00, 0x16, 0x19, 0x19, 0x16, 0x10, 0x10, 0x00 ],
  "q" : [ 0x00, 0x0D, 0x13, 0x13, 0x0D, 0x01, 0x01, 0x00 ],
  "r" : [ 0x00, 0x00, 0x16, 0x19, 0x10, 0x10, 0x10, 0x00 ],
  "s" : [ 0x00, 0x00, 0x0F, 0x10, 0x1E, 0x01, 0x1F, 0x00 ],
  "t" : [ 0x08, 0x08, 0x1C, 0x08, 0x08, 0x09, 0x06, 0x00 ],
  "u" : [ 0x00, 0x00, 0x12, 0x12, 0x12, 0x12, 0x0D, 0x00 ],
  "v" : [ 0x00, 0x00, 0x11, 0x11, 0x11, 0x0A, 0x04, 0x00 ],
  "w" : [ 0x00, 0x00, 0x11, 0x11, 0x15, 0x15, 0x0A, 0x00 ],
  "x" : [ 0x00, 0x00, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x00 ],
  "y" : [ 0x00, 0x00, 0x11, 0x11, 0x13, 0x0D, 0x01, 0x0E ],
  "z" : [ 0x00, 0x00, 0x1F, 0x02, 0x04, 0x08, 0x1F, 0x00 ],
  "{" : [ 0x02, 0x04, 0x04, 0x08, 0x04, 0x04, 0x02, 0x00 ],
  "|" : [ 0x04, 0x04, 0x04, 0x00, 0x04, 0x04, 0x04, 0x00 ],
  "}" : [ 0x08, 0x04, 0x04, 0x02, 0x04, 0x04, 0x08, 0x00 ],
  "~" : [ 0x08, 0x15, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00 ]
};

module.exports = LedControl;
