$( document ).ready(function() {

    var countdownFunction = function() {
        var elem = document.getElementById("countdown");
        var t = moment().fromNow([2018, 3, 23]);
        elem.innerText = `${t.toString()}`
    }

    setInterval(countdownFunction, 1000)
});