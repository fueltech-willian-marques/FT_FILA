let _io = null

function setIO(io) { _io = io }
function getIO()   { return _io }

module.exports = { setIO, getIO }
