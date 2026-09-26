"""Exercise the actual search layout and interactions without weather API calls."""
import json
from threading import Thread

import pytest

playwright = pytest.importorskip('playwright.sync_api')
from app import app
from werkzeug.serving import make_server

PLACES = [dict(name=f'Aktau {i}', admin1='Mangystau', country='Kazakhstan',
               latitude=43+i/100, longitude=51) for i in range(12)]
EVENT = dict(time='2026-09-26T18:00', score=dict(score=68, label='Good', reasons=[]), conditions={})
FORECAST = dict(days=[dict(date='2026-09-26', sunrise=EVENT, sunset=EVENT)],
                timezoneAbbreviation='GMT+5', elevation=123)


@pytest.fixture(scope='module')
def server():
    server = make_server('127.0.0.1', 0, app, threaded=True)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{server.server_port}'
    server.shutdown()
    thread.join()


@pytest.fixture(scope='module')
def browser():
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        yield browser
        browser.close()


def open_page(browser, server, width=390, saved=True):
    page = browser.new_page(viewport=dict(width=width, height=844), service_workers='block')
    page.add_init_script("Object.defineProperty(navigator, 'geolocation', {value: {getCurrentPosition(ok, fail) {fail({code: 1})}}});")
    if saved:
        place = dict(name='Current location', admin1='GPS detected', latitude=51, longitude=0)
        page.add_init_script(f"localStorage.setItem('sunscape:last-place:v1', JSON.stringify({json.dumps(place)}));")
    page.route('**/api/forecast?*', lambda route: route.fulfill(json=FORECAST))
    page.route('**/api/search?*', lambda route: route.fulfill(json=dict(results=PLACES)))
    page.goto(server)
    playwright.expect(page.locator('body')).not_to_have_class(__import__('re').compile(r'\bbooting\b'))
    return page


def search(page):
    page.locator('#query').fill('Aktau')
    page.locator('#search-button').click()
    playwright.expect(page.locator('#results')).to_be_visible()


@pytest.mark.parametrize('width', [360, 390, 1280])
@pytest.mark.parametrize('saved', [False, True])
def test_results_do_not_overlap_and_last_result_is_selectable(browser, server, width, saved):
    page = open_page(browser, server, width, saved)
    try:
        search(page)
        box = page.locator('#results')
        if saved:
            playwright.expect(page.locator('#place-name')).to_have_text('Current location')
            assert box.bounding_box()['y'] + box.bounding_box()['height'] <= page.locator('#dashboard').bounding_box()['y']
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert box.evaluate('(el) => el.scrollHeight > el.clientHeight')
        last = box.locator('button').last
        last.scroll_into_view_if_needed()
        assert last.evaluate('(el) => {const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}')
        last.click()
        playwright.expect(page.locator('#place-name')).to_have_text('Aktau 11')
        playwright.expect(page.locator('#query')).to_have_value('Aktau 11')
        playwright.expect(box).to_be_hidden()
        playwright.expect(page.locator('#place-meta')).to_contain_text('Kazakhstan · GMT+5')
    finally:
        page.close()


def test_search_dismissal_empty_and_failure(browser, server):
    page = open_page(browser, server)
    try:
        search(page)
        page.locator('#query').focus()
        page.keyboard.press('ArrowDown')
        playwright.expect(page.locator('#results button').first).to_be_focused()
        page.keyboard.press('Escape')
        playwright.expect(page.locator('#results')).to_be_hidden()
        playwright.expect(page.locator('#query')).to_be_focused()
        search(page)
        page.locator('#query').fill('Another city')
        playwright.expect(page.locator('#results')).to_be_hidden()
        search(page)
        page.locator('#place-name').click()
        playwright.expect(page.locator('#results')).to_be_hidden()
        page.route('**/api/search?*', lambda route: route.fulfill(json=dict(results=[])))
        page.locator('#search-button').click()
        playwright.expect(page.locator('#search-status')).to_contain_text('No matching locations')
        page.keyboard.press('Escape')
        playwright.expect(page.locator('#search-status')).to_be_hidden()
        page.route('**/api/search?*', lambda route: route.fulfill(status=503, json=dict(error='Search unavailable')))
        page.locator('#search-button').click()
        playwright.expect(page.locator('#error')).to_have_text('Search unavailable')
        playwright.expect(page.locator('#results')).to_be_hidden()
        playwright.expect(page.locator('#place-name')).to_have_text('Current location')
    finally:
        page.close()


def test_old_response_cannot_reopen_edited_search(browser, server):
    page = open_page(browser, server)
    try:
        page.evaluate("""() => {const original = window.fetch; window.fetch = (url, options) =>
          url.startsWith('/api/search') ? new Promise(resolve => {window.finishSearch = () => resolve({ok:true, json:async()=>({results:[{name:'Old result'}]})});}) : original(url, options);} """)
        page.locator('#query').fill('Old query')
        page.locator('#search-button').click()
        page.wait_for_function('typeof window.finishSearch === "function"')
        page.locator('#query').fill('New query')
        page.evaluate('window.finishSearch()')
        playwright.expect(page.locator('#search-button')).to_be_enabled()
        playwright.expect(page.locator('#results')).to_be_hidden()
        playwright.expect(page.locator('#search-status')).to_be_hidden()
    finally:
        page.close()
