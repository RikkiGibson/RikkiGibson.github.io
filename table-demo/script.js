
function bodyScroll(e) {
    var header = document.getElementById('header');
    var body = document.getElementById('body');
    header.scrollLeft = body.scrollLeft;

    var fixed = document.getElementById('fixed');
    fixed.style.left = body.scrollLeft;
}