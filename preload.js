const QRCode = require('qrcode');
const fs = require('fs');
const pfs = fs.promises;
const csvParse = require('csv-parse');
const mergeImages = require('merge-images');
const path = require('path');
const PromiseFileReader = require('promise-file-reader');

const SAVE_DIR = path.join('save');
const getRelativePath = (file) => path.join(SAVE_DIR, file);

const CSV_DB = getRelativePath('coupons.csv');

const ID = 'Identifiant';
const FULL_NAME = 'Nom du participant';
const EMAIL = 'Adresse courriel';
const PHONE = 'Numero de telephone';

const state = {
	settings: {
		qr: {
			size: 250,
			x: 25,
			y: 25,
		},
		background: {
			width: 1000,
			height: 300
		},
	},
	db: [],
	background: null,
}

const getImageFromInput = (input) => {
	return input.files[0];
}

const getCouponId = (index) => {
	const d = new Date();

	const dateStamp = [
		formatInt(d.getFullYear(), 4),
		formatInt(d.getMonth(), 2),
		formatInt(d.getDay(), 2),
	].join('');

	return dateStamp + '-' + formatInt(index, 3);
};

const removeBase64Prefix = (base64String, type = 'image/png') => base64String.replace(new RegExp(`^data:${type};base64,`), '');

const formatInt = (value, length = 2) => {
	let stringValue = `${Math.floor(value)}`;
	const valueLength = stringValue.length;

	const lengthDiff = length - valueLength;

	if (lengthDiff < 0) {
		throw new Error(`Value too long. ${value} has a larger length than ${length} characters`);
	}

	for (let i = 0; i < lengthDiff; i++) {
		stringValue = `0${stringValue}`;
	}

	return stringValue;
}

const generateQrCode = (payload) => new Promise((resolve, reject) => {
	QRCode.toDataURL(payload, { width: state.settings.qr.size }, (err, url) => {
		if (err) {
			reject(err);
			return;
		}

		resolve(url);
	});
});

const generateCoupon = async (base64QR) => {
	return await mergeImages([
		{ src: state.background.path, x: 0, y: 0 },
		{ src: base64QR, x: state.settings.qr.x, y: state.settings.qr.y },
	]);
}

const saveFile = async (content, fileName, contentType = 'base64') => {
	await pfs.writeFile(getRelativePath(fileName), content, contentType);
}

const initDb = async () => {
	await pfs.writeFile(CSV_DB, [ID, FULL_NAME, EMAIL, PHONE].join(','));
}

const loadDB = async () => {
	if (!fs.existsSync(CSV_DB)) {
		await initDb();
	}

	const file = await pfs.readFile(CSV_DB, 'utf-8');

	const [, ...rows] = await new Promise((resolve, reject) => {
		csvParse(file, {}, (err, output) => {
			if (err) {
				reject(err);
				return;
			}
	
			resolve(output);
		});
	});

	if (rows.length === 0) {
		await initDb();
	}

	state.db = rows;
}

const saveToDB = async ({ id, name, email, phone }) => {
	await pfs.appendFile(CSV_DB, '\n' + [id, name, email, phone].join(','));
}

const clearPreview = () => {
	document.querySelector('#preview').innerHTML = '';
}

const appendPreviewImage = (image64) => {
	const image = new Image();
	image.src = image64;
	image.style.maxWidth = '100%';
	document.querySelector('#preview').appendChild(image);
}

const createCoupon = async (index, data) => {
	const couponId = getCouponId(index);

	const payload = {
		id: couponId || 'null',
		name: data.name || 'null',
		email: data.email || 'null',
		phone: data.phone || 'null',
	};
	
	const base64QR = await generateQrCode(JSON.stringify(payload));
	const couponBase64 = await generateCoupon(base64QR);

	await saveFile(removeBase64Prefix(couponBase64), `qr_${couponId}.png`);

	await saveToDB(payload);

	appendPreviewImage(couponBase64);
}

const setSettings = (data = {}) => {
	state.settings.qr.size = data['qr-size'] || state.settings.qr.size;
	state.settings.qr.x = data['qr-x'] || state.settings.qr.x;
	state.settings.qr.y = data['qr-y'] || state.settings.qr.y;
}

window.addEventListener('DOMContentLoaded', () => {
	if (!fs.existsSync(SAVE_DIR)) {
		fs.mkdirSync(SAVE_DIR);
	}

	document.querySelector('input[name="background"]').addEventListener('change', async (e) => {
		clearPreview();
		state.background = getImageFromInput(e.target);

		const img64 = await PromiseFileReader.readAsDataURL(state.background);
		const img = new Image();
		img.src = img64;
		
		img.onload = () => {
			document.querySelector('#bg-size').innerHTML = `${img.width}x${img.height}`;
		}
	});

	document.querySelector('form').addEventListener('submit', async (e) => {
		e.preventDefault();

		clearPreview();

		await loadDB();

		const formData = new FormData(e.target);

		const data = Array.from(formData.entries()).reduce((acc, [key, value]) => {
			acc[key] = value;

			return acc;
		}, {});

		setSettings(data);

		for (let i = 0; i < data.qty; i++) {
			const index = state.db.length + i;
			await createCoupon(index, data);
		}
	});
});