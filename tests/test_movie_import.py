"""Protect viewing chronology, rewatch history, and the public-data boundary."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('import_movies', Path(__file__).parents[1] / 'scripts/import_movies.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def row(title, year='2000', **extra):
    return {'Name': title, 'Year': year, 'Date': '2026-10-01',
            'Rating': '5', 'Letterboxd URI': 'https://letterboxd.com/private/',
            'Tags': 'private-tag', **extra}


class MovieImportTest(unittest.TestCase):
    def test_dates_come_from_viewings_and_rewatches_survive(self):
        diary = [row('A', **{'Watched Date': '2024-01-01'}),
                 row('A', **{'Watched Date': '2025-06-01', 'Rewatch': 'Yes'}),
                 row('B', **{'Watched Date': '2023-01-01'})]
        data = module.import_movies(diary, [row('A'), row('B'), row('C')])
        self.assertEqual([v['date'] for v in data['viewings']],
                         ['2025-06-01', '2024-01-01', '2023-01-01'])
        self.assertTrue(data['viewings'][0]['rewatch'])
        self.assertEqual(len(data['films']), 3)
        self.assertEqual(data['earlier'], [module.film_id(('c', '2000'))])

    def test_unlogged_movies_have_no_invented_viewing_dates(self):
        data = module.import_movies([row('A', **{'Watched Date': ''})], [row('A')])
        self.assertEqual(data['viewings'], [])
        self.assertEqual(len(data['earlier']), 1)
        self.assertEqual(set(data['films'][0]), {'id', 'title', 'year'})

    def test_distinguishes_remakes_and_merges_title_case(self):
        data = module.import_movies([], [row('Dune', '1984'), row('Dune', '2021'), row(' DUNE ', '2021')])
        self.assertEqual(len(data['films']), 2)
        self.assertEqual(len(set(data['earlier'])), 2)

    def test_diary_only_film_is_retained(self):
        data = module.import_movies([row('A', **{'Watched Date': '2024-01-01'})], [])
        self.assertEqual(len(data['films']), 1)
        self.assertEqual(len(data['viewings']), 1)
        self.assertEqual(data['earlier'], [])

    def test_invalid_viewing_date_fails_instead_of_using_added_date(self):
        with self.assertRaises(ValueError):
            module.import_movies([row('A', **{'Watched Date': '2025-99-12'})], [])


if __name__ == '__main__':
    unittest.main()
