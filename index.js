require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const moment = require('moment');

// add stealth plugin and use defaults (all evasion techniques)
puppeteer.use(require('puppeteer-extra-plugin-stealth')());
puppeteer.use(require('puppeteer-extra-plugin-click-and-wait')());
puppeteer.use(require('puppeteer-extra-plugin-adblocker')());

const {
  HEADLESS = false,
  SLOWMO = 0,
  FLVS_USERNAME,
  FLVS_PASSWORD,
} = process.env;

const defaultPuppeteerOptions = {
  dumpio: false,
  headless: HEADLESS,
  defaultViewport: {
    width: 1920,
    height: 1080,
  },
  slowMo: SLOWMO,
  userDataDir: '/tmp',
  ignoreHTTPSErrors: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
};

const students = [
  { name: 'Alexander Scragg', id: '4959341' },
  { name: 'Julia Scragg', id: '4959339' },
];

let page;

const getText = async (sel) => {
  await page.waitForSelector(sel);
  const element = await page.$(sel);
  return await page.evaluate((el) => el.textContent, element);
};

const containsText = async (sel, text) => {
  return (await getText(sel)).includes(text);
};

const login = async () => {
  await page.goto('https://login.flvs.net/', { waitUntil: 'networkidle0' });

  await page.type('#Username', FLVS_USERNAME);
  await page.type('#Password', FLVS_PASSWORD);

  await page.click('form input[type=submit]');

  await page.waitForNavigation({ waitUntil: 'networkidle0' });
};

const gotoDashboard = async () => {
  await page.goto('https://vsa.flvs.net', { waitUntil: 'networkidle0' });
};

const gotoStudentReport = async () => {
  await page.clickAndWaitForNavigation('#idBar a');
};

const getStudentEnrollmentTable = async () => {
  await page.waitForSelector('#Pane6 .flvs-table');
  return await page.$eval('#Pane6 .flvs-table', (el) => {
    const tableToJson = (table) => {
      const data = [];

      // first row needs to be headers
      const headers = [];
      for (let i = 0; i < table.rows[0].cells.length; i++) {
        headers[i] = table.rows[0].cells[i].innerHTML
          .toLowerCase()
          .replace(/ /gi, '');
      }

      // go through cells
      for (let i = 1; i < table.rows.length; i++) {
        let tableRow = table.rows[i];
        const rowData = {};

        for (var j = 0; j < tableRow.cells.length; j++) {
          rowData[headers[j]] = tableRow.cells[j].innerHTML;
        }

        data.push(rowData);
      }

      return data;
    };

    return tableToJson(el);
  });
};

const selectFirstCourse = async () => {
  await page.waitForSelector('#dashboard');
  await page.clickAndWaitForNavigation('#dashboard .dashboard__item a');
};

const getCoursesFromDropdown = async () => {
  await page.waitForSelector('#observerUl');
  const links = await page.$$eval('#observerUl a', (el) =>
    el.map((x) => x.getAttribute('href'))
  );

  const labels = [];
  const els = await page.$$('#observerUl .dropdown-item');

  for (const element of els) {
    labels.push(
      (await page.evaluate((el) => el.textContent, element))
        .trim()
        .split('\n')[0]
    );
  }

  const courses = [];
  for (let i = 0; i < links.length; i++) {
    courses.push({
      name: labels[i],
      url: links[i],
    });
  }

  return courses;
};

const selectStudent = async (student) => {
  // check if student is already selected
  if (await containsText('#idBar', student.name)) {
    // already selected
    return;
  }

  await page.waitForSelector('#Pane6 select');
  await page.select('#Pane6 select', student.id);
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
};

const gotoGradebook = async () => {
  await page.waitForSelector('.navbar-nav');

  const navItems = await page.$$('.navbar-nav a');
  for (const item of navItems) {
    const textContent = await page.evaluate((el) => el.textContent, item);
    if (textContent.includes('Gradebook')) {
      await Promise.all([
        item.click(),
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
      ]);
      return;
    }
  }
};

const main = async () => {
  const output = [];
  const browser = await puppeteer.launch(defaultPuppeteerOptions);
  page = await browser.newPage();
  await login();
  await gotoDashboard();

  for (const student of students) {
    await selectStudent(student);
    await selectFirstCourse();
    const courses = await getCoursesFromDropdown();
    for (const course of courses) {
      await page.goto(course.url, { waitUntil: 'networkidle0' });
      await gotoGradebook();
      const lastSubmitted = (await getText('.last-submitted-date')).trim();

      const momentObj = moment(new Date(lastSubmitted));

      output.push({
        name: student.name,
        course: course.name,
        lastSubmitted,
        fromNow: momentObj.fromNow(),
        ts: momentObj.unix(),
      });

      // console.log(output);
    }
    await gotoDashboard();
  }

  output.sort((a,b) => (a.ts > b.ts) ? 1 : ((b.ts > a.ts) ? -1 : 0))

  console.log(JSON.stringify(output, null, 2));
  await page.waitForTimeout(60000);
  browser.close();
};

main();
